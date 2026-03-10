import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const key = process.env.DEEPSEEK_API_KEY;
const url = "https://api.deepseek.com/chat/completions";

async function test() {
    console.log("Testing DeepSeek API Key...");
    try {
        const res = await axios.post(url, {
            model: "deepseek-chat",
            messages: [{ role: "user", content: "hi" }]
        }, {
            headers: { "Authorization": `Bearer ${key}` }
        }, { timeout: 10000 });
        console.log("Status:", res.status);
        console.log("Content:", res.data.choices[0].message.content);
        console.log("SUCCESS!");
    } catch (e) {
        console.error("DeepSeek Error!");
        if (e.response) {
            console.error("Status:", e.response.status);
            console.error("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.error("Message:", e.message);
        }
    }
}
test();
