import axios from 'axios';
import { supabase, supabaseAdmin } from './src/config/supabase.js';

const db = supabaseAdmin || supabase;

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

function extractXmlSection(xml, loincCodes = [], fallbackRegex = null) {
  if (!xml) return null;

  let startIndex = -1;

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

function extractAllSectionsFromXml(xml) {
  if (!xml) return null;

  const sectionsToFind = [
    { 
      key: 'boxed_warning', 
      loinc: ['34066-1'], 
      fallback: /<title[^>]*>[\s\S]*?(boxed\s+warning|black\s+box)[\s\S]*?<\/title>/i, 
      label: 'Boxed Warning (Critical Safety Alert)' 
    },
    { 
      key: 'indications', 
      loinc: ['34067-9'], 
      fallback: /<title[^>]*>[\s\S]*?(indications\s+and\s+usage|uses\b)[\s\S]*?<\/title>/i, 
      label: 'Uses & Clinical Indications' 
    },
    { 
      key: 'dosage', 
      loinc: ['34068-7'], 
      fallback: /<title[^>]*>[\s\S]*?(dosage\s+and\s+administration|directions\b)[\s\S]*?<\/title>/i, 
      label: 'Dosage & Administration (Directions)' 
    },
    { 
      key: 'contraindications', 
      loinc: ['34070-3'], 
      fallback: /<title[^>]*>[\s\S]*?(contraindications\b|do\s+not\s+use\b)[\s\S]*?<\/title>/i, 
      label: 'Contraindications' 
    },
    { 
      key: 'warnings', 
      loinc: ['43685-7', '34071-1', '42232-9'], 
      fallback: /<title[^>]*>[\s\S]*?(warnings\s+and\s+precautions|warnings\b|precautions\b)[\s\S]*?<\/title>/i, 
      label: 'Warnings & Precautions' 
    },
    { 
      key: 'interactions', 
      loinc: ['34073-7'], 
      fallback: /<title[^>]*>[\s\S]*?(drug\s+interactions\b)[\s\S]*?<\/title>/i, 
      label: 'Drug Interactions' 
    },
    { 
      key: 'specific_populations', 
      loinc: ['43684-0', '42228-7', '77290-5', '34081-0', '34082-8'], 
      fallback: /<title[^>]*>[\s\S]*?(use\s+in\s+specific\s+populations|pregnancy|pediatric\s+use|geriatric\s+use)[\s\S]*?<\/title>/i, 
      label: 'Use in Specific Populations (Pregnancy, Pediatric, Geriatric, Renal)' 
    },
    { 
      key: 'active_ingredient', 
      loinc: ['55106-9'], 
      fallback: /<title[^>]*>[\s\S]*?(active\s+ingredient)[\s\S]*?<\/title>/i, 
      label: 'Active Ingredient & Strength' 
    },
    { 
      key: 'purpose', 
      loinc: ['55105-1'], 
      fallback: /<title[^>]*>[\s\S]*?(purpose\b)[\s\S]*?<\/title>/i, 
      label: 'Purpose' 
    },
    { 
      key: 'inactive_ingredients', 
      loinc: ['51727-6'], 
      fallback: /<title[^>]*>[\s\S]*?(inactive\s+ingredients)[\s\S]*?<\/title>/i, 
      label: 'Inactive Ingredients' 
    },
    { 
      key: 'overdosage_safety', 
      loinc: ['50565-1', '34088-5'], 
      fallback: /<title[^>]*>[\s\S]*?(keep\s+out\s+of\s+reach\s+of\s+children|overdose|overdosage)[\s\S]*?<\/title>/i, 
      label: 'Overdosage & Safety Handling' 
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

async function refreshAllLabels() {
  try {
    const { data: labels } = await db.from('dailymed_labels').select('id, setid, drug_name');
    console.log(`Found ${labels.length} labels in database to re-extract.`);

    for (const l of labels) {
      console.log(`Re-fetching full monograph for ${l.drug_name} (${l.setid})...`);
      try {
        const res = await axios.get(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${l.setid}.xml`, { timeout: 15000 });
        const fullMonograph = extractAllSectionsFromXml(res.data);
        if (fullMonograph && fullMonograph.length > 100) {
          await db.from('dailymed_labels').update({
            dosage_text: fullMonograph,
            last_checked_at: new Date().toISOString()
          }).eq('id', l.id);
          console.log(`✅ Updated ${l.drug_name} (${fullMonograph.length} chars).`);
        }
      } catch (err) {
        console.warn(`Could not refresh ${l.drug_name}:`, err.message);
      }
    }
    console.log('🎉 All stored labels updated with full monographs!');
  } catch (e) {
    console.error(e.message);
  }
}

refreshAllLabels();
