require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"]
}));

app.use(express.json({ limit: "10mb" }));

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.SUPABASE_ANON_KEY
) {
  console.error("❌ Missing Supabase environment variables");
  process.exit(1);
}

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DUPLICATE_WINDOW_MS = 10000;
const COMMAND_EXPIRE_MS = 5000;

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Time Lens Supabase API running"
  });
});

app.post("/api/send-era", async (req, res) => {
  try {
    console.log("\n==============================");
    console.log("📥 POST /api/send-era");
    console.log("Body:", req.body);

    const { accessToken, era } = req.body || {};

    if (!accessToken || !era) {
      return res.status(400).json({
        success: false,
        message: "accessToken and era are required"
      });
    }

    const allowedEras = ["ramsess", "ahmose", "nefertari"];

    if (!allowedEras.includes(era)) {
      return res.status(400).json({
        success: false,
        message: "Invalid era"
      });
    }

    const userSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    );

    const { data: authData, error: authError } =
      await userSupabase.auth.getUser();

    if (authError || !authData.user) {
      console.error("❌ AUTH ERROR:", authError);

      return res.status(401).json({
        success: false,
        message: "Invalid access token"
      });
    }

    const uid = authData.user.id;
    const email = authData.user.email || "";

    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("id, email, full_name, headset_id, has_access")
      .eq("id", uid)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found"
      });
    }

    if (profile.has_access !== true) {
      return res.status(403).json({
        success: false,
        message: "User has no access"
      });
    }

    if (!profile.headset_id) {
      return res.status(403).json({
        success: false,
        message: "No headset assigned to this user"
      });
    }

    const headsetId = profile.headset_id;
    const now = new Date();

    const { data: oldCommand } = await adminSupabase
      .from("headset_commands")
      .select("headset_id, era, updated_at")
      .eq("headset_id", headsetId)
      .eq("era", era)
      .maybeSingle();

    if (oldCommand && oldCommand.updated_at) {
      const diffMs =
        now.getTime() - new Date(oldCommand.updated_at).getTime();

      if (diffMs < DUPLICATE_WINDOW_MS) {
        console.log("⚠️ Duplicate command ignored");

        return res.status(200).json({
          success: true,
          message: "Duplicate command ignored",
          headsetId,
          era
        });
      }
    }

    const { error: commandError } = await adminSupabase
      .from("headset_commands")
      .upsert(
        {
          headset_id: headsetId,
          uid,
          email: profile.email || email,
          era,
          updated_at: now.toISOString()
        },
        {
          onConflict: "headset_id"
        }
      );

    if (commandError) {
      return res.status(500).json({
        success: false,
        message: commandError.message
      });
    }

    console.log("✅ Era saved:", era, "for", headsetId);

    return res.status(200).json({
      success: true,
      message: "Era sent successfully",
      uid,
      email: profile.email || email,
      headsetId,
      era
    });

  } catch (error) {
    console.error("💥 SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/unity/check/:headsetId", async (req, res) => {
  try {
    const headsetId = req.params.headsetId;

    console.log(`🎮 Unity checking headset: ${headsetId}`);

    const { data: command, error } = await adminSupabase
      .from("headset_commands")
      .select("*")
      .eq("headset_id", headsetId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    if (!command) {
      return res.status(200).json({
        success: false,
        message: "No new command",
        headsetId
      });
    }

    const ageMs =
      Date.now() - new Date(command.updated_at).getTime();

    if (ageMs > COMMAND_EXPIRE_MS) {
      await adminSupabase
        .from("headset_commands")
        .delete()
        .eq("headset_id", headsetId);

      console.log("⏰ Command expired and deleted");

      return res.status(200).json({
        success: false,
        message: "Command expired",
        headsetId
      });
    }

    const commandToSend = { ...command };

    const { error: deleteError } = await adminSupabase
      .from("headset_commands")
      .delete()
      .eq("headset_id", headsetId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        message: deleteError.message
      });
    }

    console.log("✅ Command sent to Unity and deleted:", commandToSend);

    return res.status(200).json({
      success: true,
      ...commandToSend
    });

  } catch (error) {
    console.error("💥 Unity endpoint error:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
