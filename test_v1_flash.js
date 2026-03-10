import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${key}`;

async function runTest() {
    try {
        console.log("Testing with gemini-1.5-flash on v1...");
        const res = await axios.post(url, {
            contents: [{ parts: [{ text: "ping" }] }]
        });
        console.log("SUCCESS!");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.log("FAILED!");
        if (e.response) {
            console.log("Status:", e.response.status);
            console.log("Headers:", JSON.stringify(e.response.headers, null, 2));
            console.log("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.log("Message:", e.message);
        }
    }
}

runTest();
