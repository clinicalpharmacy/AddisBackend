# ✅ PREGNANCY RULE TROUBLESHOOTING CHECKLIST

## The rule isn't triggering? Follow these steps IN ORDER:

### ☐ STEP 1: Did you CREATE the rule?

Go to **Clinical Rules Admin** and check if you see:
- Rule name: "Pregnancy - Category X Medications Contraindicated"
- Status: **Active** (green toggle)

**If NO:** 
1. Click "Create New Rule"
2. Open `COPY_PASTE_PREGNANCY_RULE.txt`
3. Copy and paste all fields
4. Make sure "Is Active" is checked ✓
5. Click SAVE

---

### ☐ STEP 2: Is the patient marked as PREGNANT?

Go to **Patient Details** and check:
- [ ] "Is Pregnant" checkbox is **CHECKED** ✓
- [ ] "Pregnancy Weeks" has a number (e.g., 12)
- [ ] "Pregnancy Trimester" is selected (e.g., First)
- [ ] You clicked **SAVE** after making changes

**If NO:**
1. Edit the patient
2. Scroll to "Pregnancy Information" section
3. Check the "Is Pregnant" box ✓
4. Enter pregnancy weeks: 12
5. Select trimester: First
6. Click SAVE
7. **Refresh the CDSS page**

---

### ☐ STEP 3: Does the patient have a contraindicated medication?

Go to **Medication History** and check:
- [ ] Medication exists with drug_name: "accutane" or "isotretinoin"
- [ ] Status shows **"Active"** (green badge)
- [ ] You clicked **SAVE** after adding the medication

**If NO:**
1. Click "Add Medication"
2. Drug Name: **accutane** (lowercase)
3. Status: **Active**
4. Start Date: Today
5. Click SAVE
6. **Refresh the CDSS page**

---

### ☐ STEP 4: Run CDSS Analysis

On the **CDSS page**:
1. Make sure the patient is selected
2. Click **"Analyze Patient"** button
3. Wait for analysis to complete

---

### ☐ STEP 5: Check Browser Console

Press **F12** to open browser console and look for:
- Any red errors?
- CDSS evaluation logs?
- Rule triggering status?

Run this command in console:
```javascript
console.log('Patient pregnant?', patientData?.is_pregnant);
console.log('Pregnancy weeks:', patientData?.pregnancy_weeks);
```

Expected output:
```
Patient pregnant? true
Pregnancy weeks: 12
```

**If you see `false` or `undefined`:**
- Go back to STEP 2
- Make sure you SAVED the patient
- Refresh the page

---

## 🔍 QUICK DEBUG SCRIPT

Open browser console (F12) and paste this:

```javascript
// Quick diagnostic
async function quickCheck() {
  console.log('=== QUICK CHECK ===\n');
  
  // 1. Patient
  console.log('1. Patient pregnant?', patientData?.is_pregnant);
  
  // 2. Medications
  const meds = await fetch('/api/medication-history/patient/' + patientData.patient_code).then(r => r.json());
  console.log('2. Medications:', meds.medications?.map(m => m.drug_name));
  
  // 3. Rules
  const rules = await fetch('/api/clinical-rules').then(r => r.json());
  const pregRule = rules.rules?.find(r => r.rule_name.includes('Pregnancy'));
  console.log('3. Pregnancy rule exists?', !!pregRule);
  console.log('   Rule active?', pregRule?.is_active);
  
  // 4. Should trigger?
  const hasContra = meds.medications?.some(m => 
    m.drug_name.toLowerCase().includes('accutane') ||
    m.drug_name.toLowerCase().includes('isotretinoin')
  );
  console.log('4. Has contraindicated med?', hasContra);
  console.log('\n=== SHOULD TRIGGER? ===');
  console.log(patientData?.is_pregnant && hasContra && pregRule?.is_active ? '✅ YES!' : '❌ NO');
}
quickCheck();
```

---

## 🎯 MOST COMMON ISSUES:

### Issue #1: Patient not saved as pregnant
**Symptom:** `patientData.is_pregnant` is `false` or `undefined`
**Fix:** Edit patient → Check "Is Pregnant" → SAVE → Refresh CDSS page

### Issue #2: Medication not active
**Symptom:** Medication exists but status is not "Active"
**Fix:** Edit medication → Change status to "Active" → SAVE → Refresh CDSS page

### Issue #3: Rule not created
**Symptom:** No pregnancy rule found in Clinical Rules Admin
**Fix:** Create the rule using `COPY_PASTE_PREGNANCY_RULE.txt`

### Issue #4: Rule not active
**Symptom:** Rule exists but toggle is OFF (gray)
**Fix:** Click the toggle to turn it ON (green) → Refresh CDSS page

### Issue #5: Wrong medication name
**Symptom:** Medication name doesn't match any in the rule
**Fix:** Change drug_name to "accutane" or "isotretinoin" (lowercase)

---

## 📸 VISUAL CHECKLIST

Take screenshots and verify:

**Patient Details:**
```
Pregnancy Information
☑ Is Pregnant
Pregnancy Weeks: [12]
Pregnancy Trimester: [First ▼]
[SAVE] ← Did you click this?
```

**Medication History:**
```
Drug Name: accutane
Status: [Active] ← Green badge
[SAVE] ← Did you click this?
```

**Clinical Rules Admin:**
```
Pregnancy - Category X Medications Contraindicated
[●] Active ← Green toggle
Severity: Critical
[Edit] [Delete]
```

**CDSS Page:**
```
Patient: [Selected patient name]
[Analyze Patient] ← Did you click this?

Analysis Results:
[Should show alert here if everything is correct]
```

---

## 🆘 STILL NOT WORKING?

If you've checked ALL of the above and it still doesn't work:

1. Open `pregnancy_rule_debugger.html` in your browser
2. Click "Run Full Diagnostic"
3. Copy the results
4. Share them so I can see exactly what's wrong

OR

Run the Quick Debug Script above and share the console output.

---

## ✅ SUCCESS CHECKLIST

When everything is working, you should see:

- ✅ Rule exists in Clinical Rules Admin
- ✅ Rule toggle is green (Active)
- ✅ Patient has "Is Pregnant" checked
- ✅ Patient has pregnancy_weeks set
- ✅ Medication "accutane" exists
- ✅ Medication status is "Active"
- ✅ CDSS shows **CRITICAL** alert with message:
  "CONTRAINDICATED: Pregnancy Category X medication detected"

---

**Remember:** After making ANY changes to patient or medications, always:
1. Click SAVE
2. Refresh the CDSS page
3. Click "Analyze Patient" again
