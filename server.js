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

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get("/", (req, res) => {
  console.log("📥 GET /");
  
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
      console.log("❌ Missing accessToken or era");

      return res.status(400).json({
        success: false,
        message: "accessToken and era are required"
      });
    }

    console.log("🎯 Era:", era);

    const allowedEras = ["ramsess", "ahmose", "nefertari"];

    if (!allowedEras.includes(era)) {
      console.log("❌ Invalid era:", era);

      return res.status(400).json({
        success: false,
        message: "Invalid era"
      });
    }

    console.log("🔐 Verifying user token...");

    const { data: authData, error: authError } =
      await supabase.auth.getUser(accessToken);

    if (authError || !authData.user) {
      console.error("❌ Auth error:", authError);

      return res.status(401).json({
        success: false,
        message: "Invalid access token"
      });
    }

    const uid = authData.user.id;
    const email = authData.user.email || "";

    console.log("✅ User authenticated");
    console.log("UID:", uid);
    console.log("Email:", email);

    console.log("📄 Fetching profile...");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, headset_id, has_access")
      .eq("id", uid)
      .single();

    if (profileError || !profile) {
      console.error("❌ Profile error:", profileError);

      return res.status(404).json({
        success: false,
        message: "Profile not found"
      });
    }

    console.log("✅ Profile found:");
    console.log(profile);

    if (profile.has_access !== true) {
      console.log("❌ User has no access");

      return res.status(403).json({
        success: false,
        message: "User has no access"
      });
    }

    if (!profile.headset_id) {
      console.log("❌ No headset assigned");

      return res.status(403).json({
        success: false,
        message: "No headset assigned to this user"
      });
    }

    const headsetId = profile.headset_id;

    console.log("🎮 Headset ID:", headsetId);
    console.log("💾 Saving command...");

    const { error: commandError } = await supabase
      .from("headset_commands")
      .upsert(
        {
          headset_id: headsetId,
          uid,
          email: profile.email || email,
          era,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "headset_id"
        }
      );

    if (commandError) {
      console.error("❌ Supabase error:", commandError);

      return res.status(500).json({
        success: false,
        message: commandError.message
      });
    }

    console.log("✅ Era saved successfully");
    console.log("==============================\n");

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

    const { data: command, error } = await supabase
      .from("headset_commands")
      .select("*")
      .eq("headset_id", headsetId)
      .maybeSingle();

    if (error) {
      console.error("❌ Unity check error:", error);

      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    if (!command) {
      console.log("ℹ️ No command found");

      return res.status(200).json({
        success: false,
        message: "No command yet"
      });
    }

    console.log("✅ Command found:", command);

    return res.status(200).json({
      success: true,
      ...command
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
