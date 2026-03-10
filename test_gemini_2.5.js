import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const model = "gemini-2.5-flash-lite";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

async function runTest() {
    try {
        console.log(`Testing with ${model}...`);
        const res = await axios.post(url, {
            contents: [
                {
                    parts: [
                        {
                            text: "Return a JSON object with a 'status' field saying 'ok'."
                        }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json"
            }
        });
        console.log("SUCCESS!");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.log("FAILED!");
        if (e.response) {
            console.log("Status:", e.response.status);
            console.log("Data:", JSON.stringify(e.response.data, null, 2));
        } else {
            console.log("Message:", e.message);
        }
    }
}

runTest();
