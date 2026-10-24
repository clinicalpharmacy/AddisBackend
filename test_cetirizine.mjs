import axios from 'axios';

async function testCetirizine() {
  const res = await axios.post('http://localhost:3000/api/dailymed/lookup-patient-meds', {
    medications: ['Cetirizine']
  });
  console.log('Found:', res.data.results[0]?.found);
  console.log('Drug:', res.data.results[0]?.query_drug);
  console.log('Title:', res.data.results[0]?.label?.label_title);
  console.log('\n--- EXTRACTED FULL MONOGRAPH PREVIEW ---');
  console.log(res.data.results[0]?.label?.dosage_text.slice(0, 700));
}

testCetirizine();
