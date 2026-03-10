import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

async function test() {
    console.log("Starting model listing...");
    try {
        const response = await axios.get(url, { timeout: 10000 });
        console.log("Status Code:", response.status);
        if (response.data && response.data.models) {
            console.log("Found models count:", response.data.models.length);
            response.data.models.forEach(m => console.log("- " + m.name));
        } else {
            console.log("No models found in data:", JSON.stringify(response.data));
        }
    } catch (e) {
        console.error("Connection error or API error!");
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", JSON.stringify(e.response.data));
        } else {
            console.error("Error Message:", e.message);
        }
    }
}
test();
