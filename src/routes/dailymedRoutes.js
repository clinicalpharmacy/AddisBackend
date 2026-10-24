import express from 'express';
import axios from 'axios';
import { supabase, supabaseAdmin } from '../config/supabase.js';

const router = express.Router();
const db = supabaseAdmin || supabase;

/**
 * Common international generic drug synonyms mapped to US FDA monograph names
 */
const DRUG_SYNONYMS = {
    'paracetamol': 'acetaminophen',
    'panadol': 'acetaminophen',
    'tylenol': 'acetaminophen',
    'salbutamol': 'albuterol',
    'ventolin': 'albuterol',
    'frusemide': 'furosemide',
    'lasix': 'furosemide',
    'adrenaline': 'epinephrine',
    'noradrenaline': 'norepinephrine',
    'amoxycillin': 'amoxicillin',
    'augmentin': 'amoxicillin'
};

/**
 * Extract generic core drug name from medication string or object
 */
function extractCoreDrugName(raw) {
    if (!raw) return '';
    let name = typeof raw === 'string' ? raw : (raw.drug_name || raw.name || raw.drug || '');
    // Remove dosage, strength, frequencies, roa, brackets
    name = name.replace(/\([^)]*\)/g, ' ')
               .replace(/\[[^\]]*\]/g, ' ')
               .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|tablets?|capsules?|tab|cap|puff|drops?)\b/gi, ' ')
               .replace(/\b(daily|once|twice|stat|tid|bid|qid|prn|po|iv|im|oral|sublingual)\b/gi, ' ')
               .replace(/[^a-zA-Z\s-]/g, ' ')
               .trim();
    // take the first word with length >= 3
    const words = name.split(/\s+/).filter(w => w.length >= 3);
    return words[0] || name;
}

/**
 * Helper to clean XML section text into readable markdown
 */
function cleanSectionXml(xmlFragment) {
    if (!xmlFragment) return '';
    return xmlFragment
        .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, '\n### $1\n')
        .replace(/<paragraph[^>]*>([\s\S]*?)<\/paragraph>/gi, '\n$1\n')
        .replace(/<item[^>]*>([\s\S]*?)<\/item>/gi, '\n• $1\n')
        .replace(/<tr[^>]*>/gi, '\n')
        .replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, ' $1 | ')
        .replace(/<table[^>]*>|<\/table>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#160;|&nbsp;/g, ' ')
        .split('\n')
        .map(l => l.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
}

/**
 * Robustly extract a section from SPL XML using LOINC codes or fallback title regex.
 * Uses depth-counting to guarantee complete capture of nested sub-sections.
 */
function extractXmlSection(xml, loincCodes = [], fallbackRegex = null) {
    if (!xml) return null;

    let startIndex = -1;

    // 1. Try finding by LOINC code
    for (const code of loincCodes) {
        const codeRegex = new RegExp(`<code[^>]*code="${code}"`, 'i');
        const codeMatch = xml.match(codeRegex);
        if (codeMatch && codeMatch.index !== undefined) {
            const sectionStart = xml.lastIndexOf('<section', codeMatch.index);
            if (sectionStart !== -1) {
                startIndex = sectionStart;
                break;
            }
        }
    }

    // 2. Fallback to title regex
    if (startIndex === -1 && fallbackRegex) {
        const titleMatch = xml.match(fallbackRegex);
        if (titleMatch && titleMatch.index !== undefined) {
            const sectionStart = xml.lastIndexOf('<section', titleMatch.index);
            if (sectionStart !== -1) {
                startIndex = sectionStart;
            }
        }
    }

    if (startIndex === -1) return null;

    // 3. Count XML depth to find matching </section>
    let depth = 0;
    let i = startIndex;
    const len = xml.length;

    while (i < len) {
        if (xml.startsWith('<section', i) && (xml[i + 8] === ' ' || xml[i + 8] === '>')) {
            depth++;
            i += 8;
        } else if (xml.startsWith('</section>', i)) {
            depth--;
            i += 10;
            if (depth <= 0) {
                return xml.substring(startIndex, i);
            }
        } else {
            i++;
        }
    }

    return xml.substring(startIndex, Math.min(startIndex + 60000, len));
}

/**
 * Clean XML text into comprehensive structured clinical sections:
 * 1. Boxed Warning (LOINC 34066-1)
 * 2. Indications & Usage / Uses (LOINC 34067-9)
 * 3. Dosage & Administration / Directions (LOINC 34068-7)
 * 4. Contraindications (LOINC 34070-3)
 * 5. Warnings and Precautions (LOINC 43685-7, 34071-1, 42232-9)
 * 6. Drug Interactions (LOINC 34073-7)
 * 7. Use in Specific Populations - Pregnancy, Pediatric, Geriatric (LOINC 43684-0, 42228-7, 34081-0, 34082-8)
 * 8. Active Ingredient & Strength / Purpose (LOINC 55106-9, 55105-1)
 * 9. Inactive Ingredients (LOINC 51727-6)
 * 10. Overdosage / Child Safety (LOINC 50565-1, 34088-5)
 */
function extractDosageFromXml(xml) {
    if (!xml) return null;

    // Core clinical sections per Eskender's specifications:
    // 1. Indication (LOINC 34067-9)
    // 2. Dosage and administration (LOINC 34068-7)
    // 3. Contraindications (LOINC 34070-3)
    // 4. Warnings and Precautions (LOINC 43685-7, 34071-1)
    // 5. Drug interactions (LOINC 34073-7)
    // 6. Use in Specific Populations (LOINC 43684-0)
    // + Boxed Warning (LOINC 34066-1) & Overdosage (LOINC 50565-1)
    const sectionsToFind = [
        { 
            key: 'boxed_warning', 
            loinc: ['34066-1'], 
            fallback: /<title[^>]*>[\s\S]*?(boxed\s+warning|black\s+box)[\s\S]*?<\/title>/i, 
            label: 'Boxed Warning (Critical Safety Hazard)' 
        },
        { 
            key: 'indications', 
            loinc: ['34067-9'], 
            fallback: /<title[^>]*>[\s\S]*?(indications\s+and\s+usage|uses\b)[\s\S]*?<\/title>/i, 
            label: 'Indications & Clinical Usage' 
        },
        { 
            key: 'dosage_and_administration', 
            loinc: ['34068-7'], 
            fallback: /<title[^>]*>[\s\S]*?(dosage\s+and\s+administration|directions\b)[\s\S]*?<\/title>/i, 
            label: 'Dosage & Administration' 
        },
        { 
            key: 'contraindications', 
            loinc: ['34070-3'], 
            fallback: /<title[^>]*>[\s\S]*?(contraindications\b|do\s+not\s+use\b)[\s\S]*?<\/title>/i, 
            label: 'Contraindications (When Medication Harms User)' 
        },
        { 
            key: 'warnings', 
            loinc: ['43685-7', '34071-1', '42232-9'], 
            fallback: /<title[^>]*>[\s\S]*?(warnings\s+and\s+precautions|warnings\b|precautions\b)[\s\S]*?<\/title>/i, 
            label: 'Warnings & Precautions (Harmful Effects on User)' 
        },
        { 
            key: 'interactions', 
            loinc: ['34073-7'], 
            fallback: /<title[^>]*>[\s\S]*?(drug\s+interactions\b)[\s\S]*?<\/title>/i, 
            label: 'Drug Interactions (Dangerous Combinations)' 
        },
        { 
            key: 'specific_populations', 
            loinc: ['43684-0', '42228-7', '77290-5', '34081-0', '34082-8'], 
            fallback: /<title[^>]*>[\s\S]*?(use\s+in\s+specific\s+populations|pregnancy|pediatric\s+use|geriatric\s+use)[\s\S]*?<\/title>/i, 
            label: 'Use in Specific Populations (Pregnancy, Nursing, Renal, Elderly)' 
        },
        { 
            key: 'overdosage_safety', 
            loinc: ['50565-1', '34088-5'], 
            fallback: /<title[^>]*>[\s\S]*?(keep\s+out\s+of\s+reach\s+of\s+children|overdose|overdosage)[\s\S]*?<\/title>/i, 
            label: 'Overdosage & Toxic Adverse Effects' 
        }
    ];

    const result = [];
    const seenTitles = new Set();

    for (const target of sectionsToFind) {
        const sectionXml = extractXmlSection(xml, target.loinc, target.fallback);

        if (sectionXml) {
            const text = cleanSectionXml(sectionXml);
            if (text && text.length > 5 && !seenTitles.has(target.label)) {
                seenTitles.add(target.label);
                result.push({
                    title: target.label,
                    text: text
                });
            }
        }
    }

    if (result.length === 0) return null;

    const combined = result.map(s => `### ${s.title}\n${s.text}`).join('\n\n');
    return combined.length >= 40 ? combined : null;
}

/**
 * 1. Search DailyMed for drug labels
 * GET /api/dailymed/search?drug=metformin
 */
router.get('/search', async (req, res) => {
    try {
        const drug = req.query.drug || req.query.drug_name || req.query.q;
        if (!drug || !drug.trim()) {
            return res.status(400).json({ success: false, error: 'Drug name is required' });
        }

        const cleanDrug = drug.trim().toLowerCase();
        const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(cleanDrug)}&pagesize=10`;
        
        const response = await axios.get(url, { timeout: 15000 });
        const labels = (response.data?.data || []).map(item => ({
            setid: item.setid,
            title: item.title,
            published_date: item.published_date,
            spl_version: item.spl_version,
            source_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.setid}`
        }));

        res.json({
            success: true,
            drug: cleanDrug,
            total: response.data?.metadata?.total_elements || labels.length,
            labels
        });
    } catch (error) {
        console.error('DailyMed Search Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to search DailyMed' 
        });
    }
});

/**
 * 2. Import a label from DailyMed and extract dosage text
 * POST /api/dailymed/import
 * Body: { setid, drug_name }
 */
router.post('/import', async (req, res) => {
    try {
        const { setid, drug_name } = req.body;
        if (!setid) {
            return res.status(400).json({ success: false, error: 'SETID is required' });
        }

        const cleanSetid = String(setid).trim();
        const cleanDrugName = (drug_name || 'Unknown Medication').trim();

        // 1. Fetch XML from DailyMed
        console.log(`[DailyMed Import] Fetching XML for SETID: ${cleanSetid}...`);
        const xmlResponse = await axios.get(
            `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${cleanSetid}.xml`,
            { timeout: 20000 }
        );
        const xmlData = xmlResponse.data;

        // 2. Extract title, version and dosage text
        const titleMatch = xmlData.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const labelTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : cleanDrugName;
        
        const versionMatch = xmlData.match(/<versionNumber[^>]*value="(\d+)"/i);
        const labelVersion = versionMatch ? parseInt(versionMatch[1], 10) : 1;

        const dosageText = extractDosageFromXml(xmlData) || 'Dosage and Administration section not found in this label format.';
        const sourceUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${cleanSetid}`;

        // 3. Upsert into public.dailymed_labels
        const record = {
            setid: cleanSetid,
            drug_name: cleanDrugName,
            label_title: labelTitle,
            label_version: labelVersion,
            published_date: new Date().toISOString().split('T')[0],
            dosage_text: dosageText,
            source_url: sourceUrl,
            review_status: 'pending',
            last_checked_at: new Date().toISOString()
        };

        const { data, error } = await db
            .from('dailymed_labels')
            .upsert(record, { onConflict: 'setid' })
            .select()
            .single();

        if (error) {
            console.error('Supabase Save Error:', error);
            throw error;
        }

        console.log(`[DailyMed Import] Successfully imported label for ${cleanDrugName} (SETID: ${cleanSetid})`);

        res.json({
            success: true,
            message: `Successfully imported label for ${cleanDrugName}`,
            label: data
        });

    } catch (error) {
        console.error('DailyMed Import Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to import label from DailyMed' 
        });
    }
});

/**
 * 3. List all imported labels from Supabase
 * GET /api/dailymed/labels
 */
router.get('/labels', async (req, res) => {
    try {
        const { drug_name, status } = req.query;
        let labels = [];

        try {
            if (db) {
                let query = db
                    .from('dailymed_labels')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (drug_name) query = query.ilike('drug_name', `%${drug_name}%`);
                if (status) query = query.eq('review_status', status);

                const { data, error } = await query;
                if (!error && data) labels = data;
            }
        } catch (dbErr) {
            // Table doesn't exist in Supabase; safe fallback
        }

        // If DB table is empty or deleted, serve items from server memory cache
        if (labels.length === 0 && memoryLabelCache.size > 0) {
            labels = Array.from(memoryLabelCache.values());
            if (drug_name) {
                labels = labels.filter(l => (l.drug_name || '').toLowerCase().includes(drug_name.toLowerCase()));
            }
        }

        res.json({
            success: true,
            count: labels.length,
            labels
        });
    } catch (error) {
        res.json({ success: true, count: 0, labels: [] });
    }
});

/**
 * 4. Update review status (approve, reject, pending)
 * PATCH /api/dailymed/labels/:id/status
 */
router.patch('/labels/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { review_status } = req.body;

        if (!['pending', 'approved', 'rejected'].includes(review_status)) {
            return res.status(400).json({ success: false, error: 'Invalid review status. Must be pending, approved, or rejected.' });
        }

        const { data, error } = await db
            .from('dailymed_labels')
            .update({
                review_status,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: `Label status updated to ${review_status}`,
            label: data
        });
    } catch (error) {
        console.error('Status Update Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// In-memory cache for fast zero-database on-demand retrieval
const memoryLabelCache = new Map();

/**
 * 5. Lookup DailyMed FDA Dosage Data for Patient Medications during Clinical Analysis
 * POST /api/dailymed/lookup-patient-meds
 * Body: { medications: [...] }
 * Works 100% on-demand directly via DailyMed REST API even if no database table exists!
 */
router.post('/lookup-patient-meds', async (req, res) => {
    try {
        const { medications } = req.body;
        if (!medications || !Array.isArray(medications) || medications.length === 0) {
            return res.json({ success: true, count: 0, results: [] });
        }

        const results = [];
        const seenNames = new Set();

        for (const rawMed of medications) {
            const drugName = extractCoreDrugName(rawMed);
            if (!drugName || drugName.length < 3 || seenNames.has(drugName.toLowerCase())) {
                continue;
            }
            seenNames.add(drugName.toLowerCase());

            const cacheKey = drugName.toLowerCase();
            const synKey = (DRUG_SYNONYMS[cacheKey] || '').toLowerCase();

            // 1. Check in-memory server cache first (instant 0ms, zero database required)
            if (memoryLabelCache.has(cacheKey) || (synKey && memoryLabelCache.has(synKey))) {
                const cached = memoryLabelCache.get(cacheKey) || memoryLabelCache.get(synKey);
                results.push({
                    query_drug: drugName,
                    original_input: typeof rawMed === 'string' ? rawMed : (rawMed.drug_name || drugName),
                    found: true,
                    source: 'memory_cache',
                    label: cached
                });
                continue;
            }

            // 2. Check local Supabase table if it exists (completely optional)
            try {
                if (db) {
                    const searchKeys = [drugName];
                    if (synKey) searchKeys.push(synKey);

                    const { data: localLabels, error: dbErr } = await db
                        .from('dailymed_labels')
                        .select('*')
                        .or(searchKeys.map(k => `drug_name.ilike.%${k}%`).join(','))
                        .order('review_status', { ascending: false })
                        .limit(3);

                    if (!dbErr && localLabels && localLabels.length > 0) {
                        const validLocal = localLabels.find(l => 
                            l.dosage_text && 
                            l.dosage_text.trim().length >= 60 && 
                            !/^(USAGE|DIRECTIONS)$/i.test(l.dosage_text.trim())
                        );

                        if (validLocal) {
                            memoryLabelCache.set(cacheKey, validLocal);
                            results.push({
                                query_drug: drugName,
                                original_input: typeof rawMed === 'string' ? rawMed : (rawMed.drug_name || drugName),
                                found: true,
                                source: 'supabase',
                                label: validLocal
                            });
                            continue;
                        }
                    }
                }
            } catch (err) {
                // Table doesn't exist or DB unreachable - safe to proceed to live DailyMed API
            }

            // 3. Fetch live on-demand from DailyMed REST API v2
            try {
                const queryTerm = DRUG_SYNONYMS[cacheKey] || drugName;
                const searchUrl = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(queryTerm)}&pagesize=10`;
                const searchRes = await axios.get(searchUrl, { timeout: 10000 });
                const splItems = searchRes.data?.data || [];

                let matchedLabel = null;
                for (const splItem of splItems) {
                    try {
                        const xmlRes = await axios.get(
                            `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${splItem.setid}.xml`,
                            { timeout: 12000 }
                        );
                        const dosageText = extractDosageFromXml(xmlRes.data);
                        if (dosageText && dosageText.length >= 60) {
                            matchedLabel = {
                                setid: splItem.setid,
                                drug_name: drugName,
                                label_title: splItem.title,
                                label_version: parseInt(splItem.spl_version, 10) || 1,
                                published_date: splItem.published_date || new Date().toISOString().split('T')[0],
                                dosage_text: dosageText,
                                source_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${splItem.setid}`,
                                review_status: 'approved',
                                last_checked_at: new Date().toISOString()
                            };
                            break;
                        }
                    } catch (e) {
                        // try next item
                    }
                }

                if (matchedLabel) {
                    // Save in server memory cache
                    memoryLabelCache.set(cacheKey, matchedLabel);
                    if (synKey) memoryLabelCache.set(synKey, matchedLabel);

                    // Optionally attempt DB save (fails silently if table is deleted)
                    try {
                        if (db) {
                            await db.from('dailymed_labels').upsert(matchedLabel, { onConflict: 'setid' });
                        }
                    } catch (e) {
                        // Table is deleted or unavailable; ignore safely
                    }

                    results.push({
                        query_drug: drugName,
                        original_input: typeof rawMed === 'string' ? rawMed : (rawMed.drug_name || drugName),
                        found: true,
                        source: 'dailymed_ondemand',
                        label: matchedLabel
                    });
                } else {
                    results.push({
                        query_drug: drugName,
                        original_input: typeof rawMed === 'string' ? rawMed : (rawMed.drug_name || drugName),
                        found: false,
                        message: 'No official DailyMed FDA label found with complete clinical parameters'
                    });
                }
            } catch (dmErr) {
                console.warn(`[DailyMed lookup error for ${drugName}]:`, dmErr.message);
                results.push({
                    query_drug: drugName,
                    original_input: typeof rawMed === 'string' ? rawMed : (rawMed.drug_name || drugName),
                    found: false,
                    message: 'DailyMed lookup timed out or service unavailable'
                });
            }
        }

        res.json({
            success: true,
            total_medications: medications.length,
            labels_found: results.filter(r => r.found).length,
            results
        });

    } catch (error) {
        console.error('DailyMed Patient Meds Lookup Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
