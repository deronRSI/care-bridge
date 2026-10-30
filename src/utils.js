import { marked } from 'marked';

export function simpleMarkdown(text) {
  const parsed = marked.parse(text || '');
  return parsed.replace(/<table>/g, '<div class="table-wrapper"><table>').replace(/<\/table>/g, '</table></div>');
}

export function extractChartData(text) {
  const charts = [];
  let cleanText = text;
  const marker = '[CHART:';
  let searchFrom = 0;
  while (true) {
    const start = cleanText.indexOf(marker, searchFrom);
    if (start === -1) break;
    const jsonStart = start + marker.length;
    let depth = 0, end = -1;
    for (let i = jsonStart; i < cleanText.length; i++) {
      if (cleanText[i] === '{') depth++;
      else if (cleanText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { searchFrom = jsonStart; continue; }
    const closer = end + 1 < cleanText.length && cleanText[end + 1] === ']' ? end + 2 : end + 1;
    const jsonStr = cleanText.substring(jsonStart, end + 1);
    try { charts.push(JSON.parse(jsonStr)); } catch (e) {}
    cleanText = cleanText.substring(0, start) + cleanText.substring(closer);
  }
  cleanText = cleanText.trim();
  if (!charts.length) return { cleanText, chartData: null, allCharts: null };
  return { cleanText, chartData: charts[0], allCharts: charts };
}

export function formatTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDisplayName(raw) {
  let name = raw.includes('@') ? raw.split('@')[0] : raw;
  name = name.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
