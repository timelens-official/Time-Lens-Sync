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
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Time Lens Supabase API running"
  });
});

app.post("/api/send-era", async (req, res) => {
  try {
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

    const { data: authData, error: authError } =
      await supabase.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return res.status(401).json({
        success: false,
        message: "Invalid access token"
      });
    }

    const uid = authData.user.id;
    const email = authData.user.email || "";

    const { data: profile, error: profileError } = await supabase
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
      return res.status(500).json({
        success: false,
        message: commandError.message
      });
    }

    return res.status(200).json({
      success: true,
      message: "Era sent successfully",
      uid,
      email: profile.email || email,
      headsetId,
      era
    });

  } catch (error) {
    console.error("ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get("/api/unity/check/:headsetId", async (req, res) => {
  try {
    const headsetId = req.params.headsetId;

    const { data: command, error } = await supabase
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
        message: "No command yet"
      });
    }

    return res.status(200).json({
      success: true,
      ...command
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
