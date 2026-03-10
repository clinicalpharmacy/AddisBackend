import { analyzePatientCDSS } from './src/services/geminiService.js';

const mockData = {
    age: 45,
    sex: 'Male',
    pregnancy: false,
    conditions: ['Hypertension'],
    medications: [{ name: 'Amlodipine', dose: '5mg' }],
    labs: { creatinine: 1.2 },
    vitals: { bp: '140/90' }
};

console.log("Starting debug analysis...");
analyzePatientCDSS(mockData)
    .then(result => {
        console.log("Success!");
        console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
        console.error("Debug Error!");
        console.error(error.message);
        if (error.response) {
            console.error("Response data:", JSON.stringify(error.response.data, null, 2));
        }
    });
