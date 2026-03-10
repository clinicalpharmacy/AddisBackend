import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

async function listModels() {
    try {
        console.log("Listing available models...");
        const res = await axios.get(url);
        console.log("Response data:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("Error listing models!");
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.error("Message:", e.message);
        }
    }
}

listModels();
