import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

async function test() {
    try {
        console.log("Testing API Key...");
        const res = await axios.post(url, {
            contents: [{ parts: [{ text: "Hello" }] }]
        });
        console.log("Success! Response received.");
        console.log("Response data:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("API Error!");
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.error("Message:", e.message);
        }
    }
}

test();
