-- Pregnancy Contraindicated Medications Rule
-- This rule checks if a pregnant patient is taking ANY medication from a list of contraindicated drugs

-- Rule: Pregnancy - Category X Medications (Absolutely Contraindicated)
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
  'Pregnancy - Category X Medications Contraindicated',
  'pregnancy_check',
  'Detects use of absolutely contraindicated medications (FDA Category X) in pregnant patients',
  '{
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
  }'::jsonb,
  '{
    "message": "CONTRAINDICATED: Pregnancy Category X medication detected",
    "recommendation": "CRITICAL ALERT: Patient is pregnant ({{pregnancy_weeks}} weeks) and is taking a Category X medication that is ABSOLUTELY CONTRAINDICATED in pregnancy.\n\nIMMEDIATE ACTIONS REQUIRED:\n1. STOP the contraindicated medication immediately\n2. Notify prescribing physician urgently\n3. Assess fetal exposure duration and timing\n4. Consider teratology consultation\n5. Discuss risks with patient\n6. Document in medical record\n7. Replace with pregnancy-safe alternative if needed\n8. Arrange appropriate fetal monitoring\n\nCommon Category X medications include:\n- Isotretinoin (Accutane) - severe birth defects\n- Thalidomide - limb malformations\n- Methotrexate - neural tube defects\n- Warfarin - fetal warfarin syndrome\n- Statins - skeletal malformations\n- Misoprostol - uterine contractions, abortion",
    "severity": "critical"
  }'::jsonb,
  'critical',
  'contraindication',
  true,
  ARRAY['pregnancy'],
  NOW(),
  NOW()
);

-- Rule: Pregnancy - ACE Inhibitors and ARBs (2nd/3rd Trimester)
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
  'Pregnancy - ACE Inhibitors/ARBs Contraindicated',
  'pregnancy_check',
  'Detects use of ACE inhibitors or ARBs in pregnant patients (especially 2nd/3rd trimester)',
  '{
    "all": [
      {
        "fact": "is_pregnant",
        "operator": "equals",
        "value": true
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "lisinopril"},
          {"fact": "medications", "operator": "contains", "value": "enalapril"},
          {"fact": "medications", "operator": "contains", "value": "ramipril"},
          {"fact": "medications", "operator": "contains", "value": "captopril"},
          {"fact": "medications", "operator": "contains", "value": "benazepril"},
          {"fact": "medications", "operator": "contains", "value": "fosinopril"},
          {"fact": "medications", "operator": "contains", "value": "perindopril"},
          {"fact": "medications", "operator": "contains", "value": "quinapril"},
          {"fact": "medications", "operator": "contains", "value": "trandolapril"},
          {"fact": "medications", "operator": "contains", "value": "losartan"},
          {"fact": "medications", "operator": "contains", "value": "valsartan"},
          {"fact": "medications", "operator": "contains", "value": "irbesartan"},
          {"fact": "medications", "operator": "contains", "value": "candesartan"},
          {"fact": "medications", "operator": "contains", "value": "olmesartan"},
          {"fact": "medications", "operator": "contains", "value": "telmisartan"},
          {"fact": "medications", "operator": "contains", "value": "azilsartan"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "CONTRAINDICATED: ACE Inhibitor/ARB in pregnancy ({{pregnancy_weeks}} weeks)",
    "recommendation": "URGENT: Pregnant patient ({{pregnancy_weeks}} weeks, {{pregnancy_trimester}} trimester) is taking an ACE inhibitor or ARB.\n\nRISKS (especially 2nd/3rd trimester):\n- Oligohydramnios (decreased amniotic fluid)\n- Fetal renal dysfunction\n- Intrauterine growth restriction\n- Neonatal hypotension\n- Renal failure in newborn\n- Skull hypoplasia\n- Fetal/neonatal death\n\nIMMEDIATE ACTIONS:\n1. DISCONTINUE ACE inhibitor/ARB immediately\n2. Switch to pregnancy-safe antihypertensive:\n   - Methyldopa (first-line)\n   - Labetalol\n   - Nifedipine (long-acting)\n   - Hydralazine\n3. Monitor blood pressure closely\n4. Arrange urgent obstetric consultation\n5. Fetal ultrasound to assess amniotic fluid\n6. Monitor fetal growth and renal function",
    "severity": "critical"
  }'::jsonb,
  'critical',
  'contraindication',
  true,
  ARRAY['pregnancy'],
  NOW(),
  NOW()
);

-- Rule: Pregnancy - NSAIDs (3rd Trimester)
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
  'Pregnancy - NSAIDs in Third Trimester',
  'pregnancy_check',
  'Detects NSAID use in pregnant patients, especially concerning in 3rd trimester',
  '{
    "all": [
      {
        "fact": "is_pregnant",
        "operator": "equals",
        "value": true
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "ibuprofen"},
          {"fact": "medications", "operator": "contains", "value": "naproxen"},
          {"fact": "medications", "operator": "contains", "value": "diclofenac"},
          {"fact": "medications", "operator": "contains", "value": "indomethacin"},
          {"fact": "medications", "operator": "contains", "value": "ketorolac"},
          {"fact": "medications", "operator": "contains", "value": "celecoxib"},
          {"fact": "medications", "operator": "contains", "value": "meloxicam"},
          {"fact": "medications", "operator": "contains", "value": "piroxicam"},
          {"fact": "medications", "operator": "contains", "value": "aspirin"},
          {"fact": "medications", "operator": "contains", "value": "ketoprofen"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "WARNING: NSAID use in pregnancy ({{pregnancy_weeks}} weeks)",
    "recommendation": "Pregnant patient ({{pregnancy_weeks}} weeks, {{pregnancy_trimester}} trimester) is taking an NSAID.\n\nRISKS (especially after 30 weeks):\n- Premature closure of ductus arteriosus\n- Pulmonary hypertension in newborn\n- Oligohydramnios\n- Prolonged labor\n- Increased bleeding risk\n- Delayed labor onset\n\nRECOMMENDATIONS:\n1. If ≥30 weeks: DISCONTINUE immediately\n2. If <30 weeks: Use lowest dose, shortest duration\n3. Avoid regular/chronic use\n4. Switch to acetaminophen for pain/fever\n5. Low-dose aspirin (81mg) may be continued if prescribed for preeclampsia prevention\n6. Monitor amniotic fluid if prolonged use\n7. Consider fetal echocardiography if used after 32 weeks",
    "severity": "high"
  }'::jsonb,
  'high',
  'contraindication',
  true,
  ARRAY['pregnancy'],
  NOW(),
  NOW()
);

-- Rule: Pregnancy - Tetracyclines
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
  'Pregnancy - Tetracycline Antibiotics Contraindicated',
  'pregnancy_check',
  'Detects tetracycline antibiotic use in pregnant patients',
  '{
    "all": [
      {
        "fact": "is_pregnant",
        "operator": "equals",
        "value": true
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "tetracycline"},
          {"fact": "medications", "operator": "contains", "value": "doxycycline"},
          {"fact": "medications", "operator": "contains", "value": "minocycline"},
          {"fact": "medications", "operator": "contains", "value": "tigecycline"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "CONTRAINDICATED: Tetracycline antibiotic in pregnancy",
    "recommendation": "ALERT: Pregnant patient ({{pregnancy_weeks}} weeks) is taking a tetracycline antibiotic.\n\nRISKS:\n- Permanent tooth discoloration (yellow-brown-gray)\n- Enamel hypoplasia\n- Impaired bone growth\n- Maternal hepatotoxicity (especially with IV tetracycline)\n- Fetal skeletal abnormalities\n\nIMMEDIATE ACTIONS:\n1. DISCONTINUE tetracycline immediately\n2. Switch to pregnancy-safe antibiotic:\n   - Penicillins (amoxicillin, ampicillin)\n   - Cephalosporins (cephalexin, ceftriaxone)\n   - Azithromycin (if needed)\n   - Nitrofurantoin (avoid near term)\n3. Document exposure in prenatal record\n4. Counsel patient on dental monitoring for child",
    "severity": "critical"
  }'::jsonb,
  'critical',
  'contraindication',
  true,
  ARRAY['pregnancy'],
  NOW(),
  NOW()
);

-- Rule: Pregnancy - Fluoroquinolones
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
  'Pregnancy - Fluoroquinolone Antibiotics',
  'pregnancy_check',
  'Detects fluoroquinolone antibiotic use in pregnant patients',
  '{
    "all": [
      {
        "fact": "is_pregnant",
        "operator": "equals",
        "value": true
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "ciprofloxacin"},
          {"fact": "medications", "operator": "contains", "value": "levofloxacin"},
          {"fact": "medications", "operator": "contains", "value": "moxifloxacin"},
          {"fact": "medications", "operator": "contains", "value": "ofloxacin"},
          {"fact": "medications", "operator": "contains", "value": "norfloxacin"},
          {"fact": "medications", "operator": "contains", "value": "gemifloxacin"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "WARNING: Fluoroquinolone antibiotic in pregnancy",
    "recommendation": "Pregnant patient ({{pregnancy_weeks}} weeks) is taking a fluoroquinolone antibiotic.\n\nCONCERNS:\n- Cartilage damage in developing fetus\n- Arthropathy risk\n- Musculoskeletal abnormalities\n- Limited human safety data\n\nRECOMMENDATIONS:\n1. Avoid unless no safer alternative exists\n2. Consider switching to:\n   - Beta-lactams (penicillins, cephalosporins)\n   - Azithromycin\n   - Other pregnancy-safe antibiotics\n3. If must continue: document risk-benefit discussion\n4. Use only when benefits clearly outweigh risks\n5. Monitor for musculoskeletal issues in infant",
    "severity": "high"
  }'::jsonb,
  'high',
  'contraindication',
  true,
  ARRAY['pregnancy'],
  NOW(),
  NOW()
);

-- Rule: Pregnancy - Antiepileptic Drugs (High Risk)
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
  'Pregnancy - High-Risk Antiepileptic Drugs',
  'pregnancy_check',
  'Detects high-risk antiepileptic drug use in pregnant patients',
  '{
    "all": [
      {
        "fact": "is_pregnant",
        "operator": "equals",
        "value": true
      },
      {
        "any": [
          {"fact": "medications", "operator": "contains", "value": "valproic acid"},
          {"fact": "medications", "operator": "contains", "value": "valproate"},
          {"fact": "medications", "operator": "contains", "value": "divalproex"},
          {"fact": "medications", "operator": "contains", "value": "phenytoin"},
          {"fact": "medications", "operator": "contains", "value": "carbamazepine"},
          {"fact": "medications", "operator": "contains", "value": "phenobarbital"},
          {"fact": "medications", "operator": "contains", "value": "topiramate"}
        ]
      }
    ]
  }'::jsonb,
  '{
    "message": "HIGH RISK: Teratogenic antiepileptic drug in pregnancy",
    "recommendation": "URGENT: Pregnant patient ({{pregnancy_weeks}} weeks) is taking a high-risk antiepileptic drug.\n\nMAJOR RISKS:\n- Valproate: Neural tube defects (spina bifida), cognitive impairment, autism spectrum disorder\n- Phenytoin: Fetal hydantoin syndrome, cleft palate\n- Carbamazepine: Neural tube defects, craniofacial abnormalities\n- Phenobarbital: Congenital heart defects, cleft palate\n- Topiramate: Cleft lip/palate, low birth weight\n\nCRITICAL ACTIONS:\n1. DO NOT stop abruptly (seizure risk to mother and fetus)\n2. URGENT neurology/maternal-fetal medicine consultation\n3. Discuss risks vs benefits of continuing\n4. Consider switching to safer alternatives:\n   - Lamotrigine (preferred)\n   - Levetiracetam\n5. High-dose folic acid (4-5 mg daily)\n6. Detailed fetal ultrasound and anatomy scan\n7. Consider amniocentesis for neural tube defects\n8. Vitamin K supplementation in 3rd trimester\n9. Monitor drug levels closely\n10. Genetic counseling",
    "severity": "critical"
  }'::jsonb,
  'critical',
  'contraindication',
  true,
  ARRAY['pregnancy'],
  NOW(),
  NOW()
);

-- Verification query
SELECT 
  rule_name,
  rule_type,
  severity,
  is_active,
  dtp_category
FROM clinical_rules
WHERE rule_name LIKE '%Pregnancy%'
ORDER BY severity DESC, rule_name;
