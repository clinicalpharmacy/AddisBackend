import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = "AIzaSyAp4e5b7ttESvavVaPbo0fm1Hz78StHASA";
const MODEL = "gemini-1.5-flash"; // Fallback
// Try to list models or just test one.

async function test() {
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            contents: [{ parts: [{ text: "Hello" }] }]
        });
        console.log("Gemini 1.5 Flash success");
    } catch (e) {
        console.error("Gemini 1.5 Flash failed:", e.response?.data || e.message);
    }
}

test();
