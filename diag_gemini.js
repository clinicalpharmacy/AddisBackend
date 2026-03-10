import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const key = process.env.GEMINI_API_KEY;
const logFile = "gemini_diagnosis.log";

async function diag() {
    const results = [];
    results.push(`Key exists: ${!!key}`);
    if (key) results.push(`Key starts with: ${key.substring(0, 5)}...`);

    const variations = [
        { api: "v1beta", model: "gemini-1.5-flash" },
        { api: "v1beta", model: "gemini-1.5-flash-latest" },
        { api: "v1beta", model: "gemini-pro" },
        { api: "v1", model: "gemini-1.5-flash" },
        { api: "v1", model: "gemini-pro" }
    ];

    for (const v of variations) {
        const url = `https://generativelanguage.googleapis.com/${v.api}/models/${v.model}:generateContent?key=${key}`;
        results.push(`\n--- Testing ${v.api} / ${v.model} ---`);
        try {
            const res = await axios.post(url, {
                contents: [{ parts: [{ text: "hi" }] }]
            }, { timeout: 5000 });
            results.push(`Status: ${res.status}`);
            results.push(`Success!`);
        } catch (e) {
            results.push(`Status: ${e.response?.status}`);
            results.push(`Error: ${e.response?.data?.error?.message || e.message}`);
        }
    }

    fs.writeFileSync(logFile, results.join("\n"));
    console.log("Diagnosis complete. Look at gemini_diagnosis.log");
}

diag();
