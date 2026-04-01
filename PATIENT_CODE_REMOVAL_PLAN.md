# Migration Plan: Dropping `patient_code` in Favor of `patient_id`

This document outlines the steps to safely remove the `patient_code` column from the database while maintaining full system functionality using the patient's unique biological ID (`patient_id` / `id`).

## 1. Database Migration (SQL)
Run these commands in your Supabase SQL Editor **BEFORE** deploying the code changes to ensure all historical data is linked.

```sql
-- A. Safe Migration: Copy the ENTIRE block below (including DO $$ and END $$)
-- This block automatically skips tables that don't exist in your database.
DO $$ 
BEGIN 
    -- medication_history
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'medication_history') THEN
        ALTER TABLE medication_history ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        UPDATE medication_history mh SET patient_id = p.id FROM patients p WHERE mh.patient_code = p.patient_code AND mh.patient_id IS NULL;
    END IF;

    -- vitals_history
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'vitals_history') THEN
        ALTER TABLE vitals_history ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        UPDATE vitals_history v SET patient_id = p.id FROM patients p WHERE v.patient_code = p.patient_code AND v.patient_id IS NULL;
    END IF;

    -- labs_history
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'labs_history') THEN
        ALTER TABLE labs_history ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        -- labs_history typically doesn't have patient_code, it might need direct linking
    END IF;

    -- drn_assessments
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'drn_assessments') THEN
        ALTER TABLE drn_assessments ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        UPDATE drn_assessments a SET patient_id = p.id FROM patients p WHERE a.patient_code = p.patient_code AND a.patient_id IS NULL;
    END IF;

    -- pharmacy_assistance_plans
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'pharmacy_assistance_plans') THEN
        ALTER TABLE pharmacy_assistance_plans ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        UPDATE pharmacy_assistance_plans pl SET patient_id = p.id FROM patients p WHERE pl.patient_code = p.patient_code AND pl.patient_id IS NULL;
    END IF;

    -- patient_outcomes
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'patient_outcomes') THEN
        ALTER TABLE patient_outcomes ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        UPDATE patient_outcomes o SET patient_id = p.id FROM patients p WHERE o.patient_code = p.patient_code AND o.patient_id IS NULL;
    END IF;
    
    -- medication_reconciliation
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'medication_reconciliation') THEN
        ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES patients(id);
        UPDATE medication_reconciliation mr SET patient_id = p.id FROM patients p WHERE mr.patient_code = p.patient_code AND mr.patient_id IS NULL;
    END IF;
END $$;
```

## 2. Updated Search Strategy
Once `patient_code` is removed, all searches (Search MRs, CDSS Analysis) will pivot to:
- Biological Full Name
- Primary Key (ID)
- Telephone Number

## 3. Deployment Steps
1. Run Section 1-B SQL in Supabase to backfill all missing patient_id values.
2. Deploy the current Backend and Frontend code updates.
3. Once satisfied, run Section 1-C below to finally drop the `patient_code` column:

```sql
-- C. FINAL CLEANUP (ONLY RUN AFTER DEPLOYING CODE)
DO $$ 
BEGIN 
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'medication_history' AND column_name = 'patient_code') THEN
        ALTER TABLE medication_history DROP COLUMN patient_code;
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'vitals_history' AND column_name = 'patient_code') THEN
        ALTER TABLE vitals_history DROP COLUMN patient_code;
    END IF;

    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'patients' AND column_name = 'patient_code') THEN
        ALTER TABLE patients DROP COLUMN patient_code;
    END IF;
    
    -- Repeat for other tables (drn_assessments, pharmacy_assistance_plans, etc.)
END $$;
```
