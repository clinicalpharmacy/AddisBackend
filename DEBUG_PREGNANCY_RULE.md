# DEBUGGING: Why Pregnancy Rule Isn't Triggering

## Step-by-Step Diagnostic Checklist

### ✅ STEP 1: Verify the Rule Exists and is Active

**Open Browser Console (F12) and run:**
```javascript
// Check if rule exists in database
fetch('/api/clinical-rules')
  .then(r => r.json())
  .then(data => {
    console.log('Total rules:', data.rules?.length);
    const pregnancyRule = data.rules?.find(r => r.rule_name.includes('Pregnancy'));
    console.log('Pregnancy rule found:', pregnancyRule);
    console.log('Is active:', pregnancyRule?.is_active);
  });
```

**Expected Output:**
- Should show the pregnancy rule
- `is_active` should be `true`

**If rule doesn't exist:** You need to create it in Clinical Rules Admin first!

---

### ✅ STEP 2: Verify Patient Pregnancy Status

**In Browser Console:**
```javascript
// Check patient data
console.log('Patient pregnancy status:', {
  is_pregnant: patientData.is_pregnant,
  pregnancy_weeks: patientData.pregnancy_weeks,
  pregnancy_trimester: patientData.pregnancy_trimester
});
```

**Expected Output:**
```
{
  is_pregnant: true,
  pregnancy_weeks: 12,
  pregnancy_trimester: "First"
}
```

**If `is_pregnant` is false or undefined:**
1. Go to Patient Details
2. Find the "Pregnancy Information" section
3. **Check the "Is Pregnant" checkbox** ✓
4. Enter pregnancy weeks (e.g., 12)
5. Select trimester
6. **SAVE the patient**
7. Refresh the CDSS page

---

### ✅ STEP 3: Verify Medication Data

**In Browser Console:**
```javascript
// Check medications
fetch('/api/medication-history/patient/' + patientData.patient_code)
  .then(r => r.json())
  .then(data => {
    console.log('Medications:', data.medications);
    data.medications?.forEach(med => {
      console.log('Drug:', med.drug_name, 'Status:', med.status, 'Active:', med.is_active);
    });
  });
```

**Expected Output:**
- Should show your medications
- At least one should have `drug_name` containing "accutane" or "isotretinoin"
- `status` should be "Active" OR `is_active` should be `true`

**If medication not showing or not active:**
1. Go to Medication History
2. Add medication with drug_name: **accutane**
3. Set Status: **Active**
4. **SAVE the medication**
5. Refresh the CDSS page

---

### ✅ STEP 4: Check CDSS Facts Generation

**In Browser Console (when on CDSS page):**
```javascript
// This should be available after analysis runs
console.log('Patient Facts:', {
  is_pregnant: facts?.is_pregnant,
  pregnancy_weeks: facts?.pregnancy_weeks,
  medications: facts?.medications,
  medication_names: facts?.medication_names,
  medication_count: facts?.medication_count
});
```

**Expected Output:**
```
{
  is_pregnant: true,
  pregnancy_weeks: 12,
  medications: ["accutane", ...],
  medication_names: ["accutane", ...],
  medication_count: 1
}
```

**If `is_pregnant` is false in facts:**
- The patient data isn't being mapped correctly
- Check that you saved the patient after checking "Is Pregnant"

**If medications array is empty:**
- Medications aren't being fetched
- Check the medication_history table has the patient_code

---

### ✅ STEP 5: Manual Rule Test

**In Browser Console:**
```javascript
// Manually test the rule condition
const testFacts = {
  is_pregnant: true,
  medications: ['accutane'],
  medication_names: ['accutane']
};

// Test if accutane is in medications
const hasAccutane = testFacts.medications.some(med => 
  med.toLowerCase().includes('accutane')
);

console.log('Has accutane:', hasAccutane);
console.log('Is pregnant:', testFacts.is_pregnant);
console.log('Should trigger:', testFacts.is_pregnant && hasAccutane);
```

**Expected Output:**
```
Has accutane: true
Is pregnant: true
Should trigger: true
```

---

### ✅ STEP 6: Check Rule Evaluation Logs

**In Browser Console, look for CDSS logs:**
```
🚀 === CDSS ANALYSIS STARTED ===
📋 Fetching clinical rules...
✅ Loaded X active rules
⚡ === EVALUATING CLINICAL RULES ===
```

**Look for:**
- "Pregnancy - Category X Medications Contraindicated": ✅ TRIGGERED
  OR
- "Pregnancy - Category X Medications Contraindicated": ❌ Not triggered

**If you see "Not triggered":**
- The condition isn't matching
- Check the facts vs the rule condition

---

## 🔧 COMMON FIXES

### Fix 1: Patient Not Marked as Pregnant
```
1. Go to Patient Details
2. Scroll to "Pregnancy Information"
3. ✓ Check "Is Pregnant"
4. Enter Pregnancy Weeks: 12
5. Select Trimester: First
6. Click SAVE
7. Refresh CDSS page
```

### Fix 2: Medication Not Active
```
1. Go to Medication History
2. Find the medication
3. Change Status to "Active"
4. Click SAVE
5. Refresh CDSS page
```

### Fix 3: Rule Not Created
```
1. Go to Clinical Rules Admin
2. Click "Create New Rule"
3. Copy-paste from COPY_PASTE_PREGNANCY_RULE.txt
4. Make sure "Is Active" is checked ✓
5. Click SAVE
6. Refresh CDSS page
```

### Fix 4: Medication Name Mismatch
```
The medication name must be exactly one of these (case-insensitive):
- accutane
- isotretinoin
- Any other drug from the list

Try changing the drug name to lowercase: "accutane"
```

---

## 🎯 QUICK TEST SCRIPT

**Run this in Browser Console to do a complete check:**

```javascript
async function debugPregnancyRule() {
  console.log('=== PREGNANCY RULE DEBUG ===\n');
  
  // 1. Check rules
  const rulesResp = await fetch('/api/clinical-rules');
  const rulesData = await rulesResp.json();
  const pregnancyRule = rulesData.rules?.find(r => r.rule_name.includes('Pregnancy'));
  console.log('1. Rule exists:', !!pregnancyRule);
  console.log('   Rule active:', pregnancyRule?.is_active);
  
  // 2. Check patient
  console.log('\n2. Patient data:');
  console.log('   Is pregnant:', patientData?.is_pregnant);
  console.log('   Pregnancy weeks:', patientData?.pregnancy_weeks);
  
  // 3. Check medications
  const medsResp = await fetch('/api/medication-history/patient/' + patientData.patient_code);
  const medsData = await medsResp.json();
  console.log('\n3. Medications:');
  medsData.medications?.forEach(med => {
    console.log('   -', med.drug_name, '(Active:', med.status === 'Active' || med.is_active, ')');
  });
  
  // 4. Check if should trigger
  const hasContraindicated = medsData.medications?.some(med => {
    const drugName = med.drug_name.toLowerCase();
    return drugName.includes('accutane') || 
           drugName.includes('isotretinoin') ||
           drugName.includes('warfarin') ||
           drugName.includes('methotrexate');
  });
  
  console.log('\n4. Analysis:');
  console.log('   Has contraindicated med:', hasContraindicated);
  console.log('   Is pregnant:', patientData?.is_pregnant);
  console.log('   SHOULD TRIGGER:', patientData?.is_pregnant && hasContraindicated);
  
  if (!pregnancyRule) {
    console.log('\n❌ PROBLEM: Rule not found in database!');
    console.log('   → Create the rule in Clinical Rules Admin');
  }
  if (!patientData?.is_pregnant) {
    console.log('\n❌ PROBLEM: Patient not marked as pregnant!');
    console.log('   → Edit patient and check "Is Pregnant"');
  }
  if (!hasContraindicated) {
    console.log('\n❌ PROBLEM: No contraindicated medication found!');
    console.log('   → Add medication with name "accutane"');
  }
  if (pregnancyRule && patientData?.is_pregnant && hasContraindicated) {
    console.log('\n✅ Everything looks good! Rule should trigger.');
    console.log('   → Try clicking "Analyze Patient" again');
  }
}

debugPregnancyRule();
```

---

## 📸 SCREENSHOT CHECKLIST

Please check these in your UI:

### In Patient Details:
- [ ] "Is Pregnant" checkbox is **CHECKED** ✓
- [ ] "Pregnancy Weeks" has a number (e.g., 12)
- [ ] "Pregnancy Trimester" is selected (e.g., First)
- [ ] Patient is **SAVED** (not just edited)

### In Medication History:
- [ ] Medication exists with drug_name "accutane" or "isotretinoin"
- [ ] Status shows "Active" (green badge)
- [ ] Medication is **SAVED**

### In Clinical Rules Admin:
- [ ] Rule "Pregnancy - Category X Medications Contraindicated" exists
- [ ] Toggle shows "Active" (green/on)
- [ ] Severity shows "Critical" (red badge)

### In CDSS Page:
- [ ] Patient is selected
- [ ] "Analyze Patient" button was clicked
- [ ] Browser console (F12) shows no errors

---

## 🆘 STILL NOT WORKING?

If you've checked everything above and it still doesn't work, please:

1. **Open Browser Console (F12)**
2. **Run the debug script above**
3. **Copy the console output**
4. **Share the output so I can see exactly what's wrong**

The debug script will tell us exactly which part is failing!
