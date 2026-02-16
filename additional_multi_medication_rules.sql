-- Additional Multi-Medication Clinical Rules
-- These rules check multiple medications at once for various clinical scenarios

-- Rule: Renal Impairment + Nephrotoxic Medications
INSERT INTO clinical_rules (
  rule_name,
  rule_type,
  rule_description,
  rule_condition,
  rule_action,
  severity,
  dtp_category,
  is_active,
  applies_to,
  created_at,
  updated_at
) VALUES (
  'Renal Impairment - Nephrotoxic Medications Alert',
  'renal_adjustment',
  'Detects use of nephrotoxic medications in patients with renal impairment',
  '{
    "all": [
      {
        "fact": "egfr",
        "operator": "<",
        "value": 60
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "gentamicin"},
          {"fact": "medications", "operator": "contains", "value": "tobramycin"},
          {"fact": "medications", "operator": "contains", "value": "amikacin"},
          {"fact": "medications", "operator": "contains", "value": "vancomycin"},
          {"fact": "medications", "operator": "contains", "value": "amphotericin"},
          {"fact": "medications", "operator": "contains", "value": "cisplatin"},
          {"fact": "medications", "operator": "contains", "value": "cyclosporine"},
          {"fact": "medications", "operator": "contains", "value": "tacrolimus"},
          {"fact": "medications", "operator": "contains", "value": "lithium"},
          {"fact": "medications", "operator": "contains", "value": "acyclovir"},
          {"fact": "medications", "operator": "contains", "value": "tenofovir"},
          {"fact": "medications", "operator": "contains", "value": "contrast media"},
          {"fact": "medications", "operator": "contains", "value": "ibuprofen"},
          {"fact": "medications", "operator": "contains", "value": "naproxen"},
          {"fact": "medications", "operator": "contains", "value": "diclofenac"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "Nephrotoxic medication in patient with renal impairment (eGFR: {{egfr}})",
    "recommendation": "Patient with reduced kidney function (eGFR: {{egfr}} mL/min/1.73m²) is taking a nephrotoxic medication.\n\nRISKS:\n- Further decline in renal function\n- Acute kidney injury\n- Drug accumulation and toxicity\n- Need for dialysis\n\nRECOMMENDATIONS:\n1. Assess necessity of nephrotoxic medication\n2. Consider safer alternatives if available\n3. If must continue:\n   - Adjust dose based on renal function\n   - Monitor serum creatinine and eGFR closely\n   - Check drug levels if available (vancomycin, gentamicin)\n   - Ensure adequate hydration\n4. Avoid combining multiple nephrotoxic agents\n5. Monitor for signs of acute kidney injury\n6. Consider nephrology consultation if eGFR <30",
    "severity": "high"
  }'::jsonb,
  'high',
  'monitoring_needed',
  true,
  ARRAY['renal_impairment'],
  NOW(),
  NOW()
);

-- Rule: Elderly Patients + Beers Criteria Medications
INSERT INTO clinical_rules (
  rule_name,
  rule_type,
  rule_description,
  rule_condition,
  rule_action,
  severity,
  dtp_category,
  is_active,
  applies_to,
  created_at,
  updated_at
) VALUES (
  'Elderly - Beers Criteria Potentially Inappropriate Medications',
  'age_check',
  'Detects potentially inappropriate medications (PIMs) in elderly patients per Beers Criteria',
  '{
    "all": [
      {
        "fact": "age",
        "operator": ">",
        "value": 65
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "diphenhydramine"},
          {"fact": "medications", "operator": "contains", "value": "hydroxyzine"},
          {"fact": "medications", "operator": "contains", "value": "promethazine"},
          {"fact": "medications", "operator": "contains", "value": "diazepam"},
          {"fact": "medications", "operator": "contains", "value": "alprazolam"},
          {"fact": "medications", "operator": "contains", "value": "lorazepam"},
          {"fact": "medications", "operator": "contains", "value": "amitriptyline"},
          {"fact": "medications", "operator": "contains", "value": "doxepin"},
          {"fact": "medications", "operator": "contains", "value": "nortriptyline"},
          {"fact": "medications", "operator": "contains", "value": "cyclobenzaprine"},
          {"fact": "medications", "operator": "contains", "value": "methocarbamol"},
          {"fact": "medications", "operator": "contains", "value": "digoxin"},
          {"fact": "medications", "operator": "contains", "value": "nifedipine"},
          {"fact": "medications", "operator": "contains", "value": "clonidine"},
          {"fact": "medications", "operator": "contains", "value": "indomethacin"},
          {"fact": "medications", "operator": "contains", "value": "ketorolac"},
          {"fact": "medications", "operator": "contains", "value": "meperidine"},
          {"fact": "medications", "operator": "contains", "value": "pentazocine"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "Potentially inappropriate medication (Beers Criteria) in elderly patient ({{age}} years)",
    "recommendation": "Elderly patient ({{age}} years old) is taking a medication listed in the Beers Criteria as potentially inappropriate.\n\nRISKS IN ELDERLY:\n- Increased fall risk\n- Cognitive impairment\n- Delirium\n- Anticholinergic burden\n- Prolonged sedation\n- Increased fracture risk\n\nRECOMMENDATIONS:\n1. Review necessity of the medication\n2. Consider safer alternatives:\n   - Antihistamines: Use cetirizine or loratadine instead\n   - Benzodiazepines: Consider trazodone for sleep, SSRIs for anxiety\n   - Tricyclic antidepressants: Use SSRIs or SNRIs\n   - Muscle relaxants: Physical therapy, acetaminophen\n3. If must continue: Use lowest effective dose\n4. Monitor for adverse effects (falls, confusion, sedation)\n5. Assess anticholinergic burden score\n6. Regular medication review",
    "severity": "moderate"
  }'::jsonb,
  'moderate',
  'age_restriction',
  true,
  ARRAY['geriatric'],
  NOW(),
  NOW()
);

-- Rule: QT-Prolonging Medications (Multiple Drugs)
INSERT INTO clinical_rules (
  rule_name,
  rule_type,
  rule_description,
  rule_condition,
  rule_action,
  severity,
  dtp_category,
  is_active,
  applies_to,
  created_at,
  updated_at
) VALUES (
  'QT Prolongation - High-Risk Medications',
  'drug_interaction',
  'Detects medications known to prolong QT interval and increase risk of Torsades de Pointes',
  '{
    "any": [
      {"fact": "medications", "operator": "contains", "value": "amiodarone"},
      {"fact": "medications", "operator": "contains", "value": "sotalol"},
      {"fact": "medications", "operator": "contains", "value": "dofetilide"},
      {"fact": "medications", "operator": "contains", "value": "quinidine"},
      {"fact": "medications", "operator": "contains", "value": "procainamide"},
      {"fact": "medications", "operator": "contains", "value": "azithromycin"},
      {"fact": "medications", "operator": "contains", "value": "clarithromycin"},
      {"fact": "medications", "operator": "contains", "value": "erythromycin"},
      {"fact": "medications", "operator": "contains", "value": "levofloxacin"},
      {"fact": "medications", "operator": "contains", "value": "moxifloxacin"},
      {"fact": "medications", "operator": "contains", "value": "ciprofloxacin"},
      {"fact": "medications", "operator": "contains", "value": "haloperidol"},
      {"fact": "medications", "operator": "contains", "value": "quetiapine"},
      {"fact": "medications", "operator": "contains", "value": "ziprasidone"},
      {"fact": "medications", "operator": "contains", "value": "citalopram"},
      {"fact": "medications", "operator": "contains", "value": "escitalopram"},
      {"fact": "medications", "operator": "contains", "value": "methadone"},
      {"fact": "medications", "operator": "contains", "value": "ondansetron"},
      {"fact": "medications", "operator": "contains", "value": "domperidone"}
    ]
  }'::jsonb,
  '{
    "message": "QT-prolonging medication detected",
    "recommendation": "Patient is taking a medication known to prolong the QT interval.\n\nRISKS:\n- QT interval prolongation\n- Torsades de Pointes (life-threatening arrhythmia)\n- Sudden cardiac death\n- Risk increases with:\n  - Multiple QT-prolonging drugs\n  - Electrolyte abnormalities (low K+, Mg2+, Ca2+)\n  - Bradycardia\n  - Female gender\n  - Structural heart disease\n\nRECOMMENDATIONS:\n1. Obtain baseline ECG before starting therapy\n2. Check electrolytes (potassium, magnesium, calcium)\n3. Correct any electrolyte abnormalities\n4. Monitor ECG periodically during therapy\n5. Avoid combining multiple QT-prolonging drugs\n6. Use lowest effective dose\n7. Consider alternative if QTc >500 ms\n8. Educate patient on symptoms (palpitations, syncope, dizziness)\n9. Review other medications for interactions",
    "severity": "high"
  }'::jsonb,
  'high',
  'adverse_drug_event',
  true,
  ARRAY['all_patients'],
  NOW(),
  NOW()
);

-- Rule: Anticholinergic Burden in Elderly
INSERT INTO clinical_rules (
  rule_name,
  rule_type,
  rule_description,
  rule_condition,
  rule_action,
  severity,
  dtp_category,
  is_active,
  applies_to,
  created_at,
  updated_at
) VALUES (
  'Elderly - High Anticholinergic Burden',
  'age_check',
  'Detects medications with strong anticholinergic effects in elderly patients',
  '{
    "all": [
      {
        "fact": "age",
        "operator": ">",
        "value": 65
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "diphenhydramine"},
          {"fact": "medications", "operator": "contains", "value": "hydroxyzine"},
          {"fact": "medications", "operator": "contains", "value": "amitriptyline"},
          {"fact": "medications", "operator": "contains", "value": "doxepin"},
          {"fact": "medications", "operator": "contains", "value": "imipramine"},
          {"fact": "medications", "operator": "contains", "value": "oxybutynin"},
          {"fact": "medications", "operator": "contains", "value": "tolterodine"},
          {"fact": "medications", "operator": "contains", "value": "solifenacin"},
          {"fact": "medications", "operator": "contains", "value": "benztropine"},
          {"fact": "medications", "operator": "contains", "value": "trihexyphenidyl"},
          {"fact": "medications", "operator": "contains", "value": "scopolamine"},
          {"fact": "medications", "operator": "contains", "value": "dicyclomine"},
          {"fact": "medications", "operator": "contains", "value": "hyoscyamine"},
          {"fact": "medications", "operator": "contains", "value": "promethazine"},
          {"fact": "medications", "operator": "contains", "value": "chlorpheniramine"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "High anticholinergic burden in elderly patient ({{age}} years)",
    "recommendation": "Elderly patient ({{age}} years) is taking medication(s) with strong anticholinergic effects.\n\nRISKS:\n- Cognitive impairment and delirium\n- Falls and fractures\n- Constipation and urinary retention\n- Dry mouth and blurred vision\n- Increased dementia risk with chronic use\n- Heat intolerance\n\nRECOMMENDATIONS:\n1. Calculate total Anticholinergic Cognitive Burden (ACB) score\n2. Discontinue or reduce anticholinergic medications if possible\n3. Consider alternatives:\n   - Allergies: Cetirizine, loratadine, fexofenadine\n   - Depression: SSRIs (sertraline, citalopram)\n   - Overactive bladder: Behavioral therapy, mirabegron\n   - Sleep: Melatonin, trazodone (low dose)\n4. Monitor for cognitive changes\n5. Assess fall risk\n6. Avoid combining multiple anticholinergic drugs\n7. Regular cognitive screening",
    "severity": "high"
  }'::jsonb,
  'high',
  'adverse_drug_event',
  true,
  ARRAY['geriatric'],
  NOW(),
  NOW()
);

-- Rule: Serotonin Syndrome Risk - Multiple Serotonergic Agents
INSERT INTO clinical_rules (
  rule_name,
  rule_type,
  rule_description,
  rule_condition,
  rule_action,
  severity,
  dtp_category,
  is_active,
  applies_to,
  created_at,
  updated_at
) VALUES (
  'Serotonin Syndrome Risk - Multiple Serotonergic Medications',
  'drug_interaction',
  'Detects use of multiple serotonergic medications that increase risk of serotonin syndrome',
  '{
    "all": [
      {
        "fact": "medication_count",
        "operator": ">=",
        "value": 2
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "fluoxetine"},
          {"fact": "medications", "operator": "contains", "value": "sertraline"},
          {"fact": "medications", "operator": "contains", "value": "paroxetine"},
          {"fact": "medications", "operator": "contains", "value": "citalopram"},
          {"fact": "medications", "operator": "contains", "value": "escitalopram"},
          {"fact": "medications", "operator": "contains", "value": "venlafaxine"},
          {"fact": "medications", "operator": "contains", "value": "duloxetine"},
          {"fact": "medications", "operator": "contains", "value": "tramadol"},
          {"fact": "medications", "operator": "contains", "value": "meperidine"},
          {"fact": "medications", "operator": "contains", "value": "fentanyl"},
          {"fact": "medications", "operator": "contains", "value": "linezolid"},
          {"fact": "medications", "operator": "contains", "value": "methylene blue"},
          {"fact": "medications", "operator": "contains", "value": "trazodone"},
          {"fact": "medications", "operator": "contains", "value": "buspirone"},
          {"fact": "medications", "operator": "contains", "value": "triptans"},
          {"fact": "medications", "operator": "contains", "value": "ondansetron"},
          {"fact": "medications", "operator": "contains", "value": "metoclopramide"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "Multiple serotonergic medications - Serotonin syndrome risk",
    "recommendation": "Patient is taking multiple medications that increase serotonin levels, increasing risk of serotonin syndrome.\n\nSEROTONIN SYNDROME SYMPTOMS:\n- Mild: Tremor, restlessness, diaphoresis, mydriasis\n- Moderate: Hyperreflexia, clonus, agitation, fever\n- Severe: Hyperthermia, seizures, altered consciousness, rigidity\n\nRECOMMENDATIONS:\n1. Review necessity of all serotonergic medications\n2. Avoid combining:\n   - SSRIs/SNRIs + Tramadol\n   - SSRIs/SNRIs + Linezolid\n   - SSRIs/SNRIs + MAO inhibitors\n   - Multiple SSRIs/SNRIs\n3. If combination necessary:\n   - Use lowest effective doses\n   - Monitor closely for symptoms\n   - Educate patient on warning signs\n4. Consider alternatives without serotonergic activity\n5. If serotonin syndrome suspected:\n   - STOP all serotonergic agents immediately\n   - Supportive care\n   - Consider cyproheptadine (antidote)",
    "severity": "high"
  }'::jsonb,
  'high',
  'drug_interaction',
  true,
  ARRAY['all_patients'],
  NOW(),
  NOW()
);

-- Verification query
SELECT 
  rule_name,
  rule_type,
  severity,
  is_active,
  applies_to
FROM clinical_rules
WHERE rule_name IN (
  'Renal Impairment - Nephrotoxic Medications Alert',
  'Elderly - Beers Criteria Potentially Inappropriate Medications',
  'QT Prolongation - High-Risk Medications',
  'Elderly - High Anticholinergic Burden',
  'Serotonin Syndrome Risk - Multiple Serotonergic Medications'
)
ORDER BY severity DESC, rule_name;
