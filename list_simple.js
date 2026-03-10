import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

async function list() {
    try {
        const key = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        const res = await axios.get(url);
        console.log("AVAILABLE_MODELS_START");
        res.data.models.forEach(m => console.log(m.name));
        console.log("AVAILABLE_MODELS_END");
    } catch (e) {
        console.error("LIST_ERROR:", e.response?.data || e.message);
    }
}
list();
