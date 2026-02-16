# Pregnancy Category X Medications Rule - For Clinical Rules Admin UI

## Step-by-Step Instructions

### 1. Navigate to Clinical Rules Admin
- Log in as an admin user
- Go to **Clinical Rules Administration** page

### 2. Click "Create New Rule"

### 3. Fill in the Form Fields:

#### **Rule Name:**
```
Pregnancy - Category X Medications Contraindicated
```

#### **Rule Type:**
Select: `Pregnancy Check`

#### **Severity:**
Select: `Critical`

#### **DTP Category:**
Select: `Contraindication`

#### **Rule Description:**
```
Detects use of absolutely contraindicated medications (FDA Category X) in pregnant patients
```

#### **Applies To:**
Select: `Pregnancy`

#### **Is Active:**
✓ Check this box

---

### 4. Rule Condition (JSON) - Copy and Paste This:

```json
{
  "all": [
    {
      "fact": "is_pregnant",
      "operator": "equals",
      "value": true
    },
    {
      "any": [
        {"fact": "medications", "operator": "contains", "value": "isotretinoin"},
        {"fact": "medications", "operator": "contains", "value": "accutane"},
        {"fact": "medications", "operator": "contains", "value": "thalidomide"},
        {"fact": "medications", "operator": "contains", "value": "methotrexate"},
        {"fact": "medications", "operator": "contains", "value": "misoprostol"},
        {"fact": "medications", "operator": "contains", "value": "finasteride"},
        {"fact": "medications", "operator": "contains", "value": "dutasteride"},
        {"fact": "medications", "operator": "contains", "value": "warfarin"},
        {"fact": "medications", "operator": "contains", "value": "statins"},
        {"fact": "medications", "operator": "contains", "value": "atorvastatin"},
        {"fact": "medications", "operator": "contains", "value": "simvastatin"},
        {"fact": "medications", "operator": "contains", "value": "rosuvastatin"},
        {"fact": "medications", "operator": "contains", "value": "lovastatin"},
        {"fact": "medications", "operator": "contains", "value": "pravastatin"},
        {"fact": "medications", "operator": "contains", "value": "ribavirin"},
        {"fact": "medications", "operator": "contains", "value": "leflunomide"},
        {"fact": "medications", "operator": "contains", "value": "mycophenolate"},
        {"fact": "medications", "operator": "contains", "value": "teriparatide"},
        {"fact": "medications", "operator": "contains", "value": "raloxifene"},
        {"fact": "medications", "operator": "contains", "value": "clomiphene"},
        {"fact": "medications", "operator": "contains", "value": "danazol"},
        {"fact": "medications", "operator": "contains", "value": "diethylstilbestrol"},
        {"fact": "medications", "operator": "contains", "value": "estazolam"},
        {"fact": "medications", "operator": "contains", "value": "flurazepam"},
        {"fact": "medications", "operator": "contains", "value": "quazepam"},
        {"fact": "medications", "operator": "contains", "value": "temazepam"},
        {"fact": "medications", "operator": "contains", "value": "triazolam"}
      ]
    }
  ]
}
```

---

### 5. Rule Action (JSON) - Copy and Paste This:

```json
{
  "message": "CONTRAINDICATED: Pregnancy Category X medication detected",
  "recommendation": "CRITICAL ALERT: Patient is pregnant ({{pregnancy_weeks}} weeks) and is taking a Category X medication that is ABSOLUTELY CONTRAINDICATED in pregnancy.\n\nIMMEDIATE ACTIONS REQUIRED:\n1. STOP the contraindicated medication immediately\n2. Notify prescribing physician urgently\n3. Assess fetal exposure duration and timing\n4. Consider teratology consultation\n5. Discuss risks with patient\n6. Document in medical record\n7. Replace with pregnancy-safe alternative if needed\n8. Arrange appropriate fetal monitoring\n\nCommon Category X medications include:\n- Isotretinoin (Accutane) - severe birth defects\n- Thalidomide - limb malformations\n- Methotrexate - neural tube defects\n- Warfarin - fetal warfarin syndrome\n- Statins - skeletal malformations\n- Misoprostol - uterine contractions, abortion",
  "severity": "critical"
}
```

---

### 6. Click "Save Rule"

---

## Testing the Rule

### Test Case: Pregnant Patient on Accutane

1. **Create or select a patient**

2. **Set pregnancy information:**
   - ✓ Check "Is Pregnant"
   - Pregnancy Weeks: `12`
   - Pregnancy Trimester: `First`

3. **Add medication:**
   - Go to Medication History
   - Add new medication:
     - Drug Name: `accutane` (or `Accutane` or `isotretinoin`)
     - Status: `Active`
     - Start Date: Today

4. **Run CDSS Analysis:**
   - Go to CDSS/Clinical Decision Support
   - Select the patient
   - Click "Analyze Patient"

5. **Expected Result:**
   - Alert appears with **Critical** severity (red)
   - Message: "CONTRAINDICATED: Pregnancy Category X medication detected"
   - Detailed recommendations displayed

---

## Troubleshooting

### If Alert Doesn't Trigger:

#### ✓ Check 1: Patient Pregnancy Status
Make sure in Patient Details:
- `is_pregnant` checkbox is **checked** ✓
- `pregnancy_weeks` has a value (e.g., 12)

#### ✓ Check 2: Medication Name
The medication name must contain one of these (case-insensitive):
- "accutane"
- "isotretinoin"
- Or any other drug from the list

#### ✓ Check 3: Medication Status
- Medication must be marked as "Active"
- Or `is_active` = true

#### ✓ Check 4: Rule is Active
- In Clinical Rules Admin, verify the rule has the green "Active" toggle ON

#### ✓ Check 5: CDSS Debug Output
- Open browser console (F12)
- Look for CDSS evaluation logs
- Check if the rule is being evaluated
- Check the `facts` object to see what data is available

---

## Quick Copy-Paste Checklist

When creating the rule, you need to paste:

1. ✓ Rule Name: `Pregnancy - Category X Medications Contraindicated`
2. ✓ Rule Type: `Pregnancy Check`
3. ✓ Severity: `Critical`
4. ✓ DTP Category: `Contraindication`
5. ✓ Description: `Detects use of absolutely contraindicated medications...`
6. ✓ Rule Condition JSON (the big JSON with "all" and "any")
7. ✓ Rule Action JSON (the JSON with "message" and "recommendation")
8. ✓ Applies To: `Pregnancy`
9. ✓ Is Active: **Checked**

---

## Common Mistakes to Avoid

❌ **Don't** forget to check "Is Active"
❌ **Don't** forget to set patient as pregnant
❌ **Don't** forget to make medication "Active"
❌ **Don't** add extra brackets in JSON
❌ **Don't** forget to click "Save Rule"

✅ **Do** verify JSON is valid before saving
✅ **Do** test with a simple case first (just "accutane")
✅ **Do** check browser console for errors
✅ **Do** refresh the CDSS page after creating the rule

---

## Need Help?

If the rule still doesn't work:
1. Check browser console (F12) for errors
2. Verify the rule appears in Clinical Rules Admin list
3. Check that the rule's "Is Active" toggle is green/on
4. Try with a different medication from the list
5. Verify patient data in browser console: `console.log(patientData)`
