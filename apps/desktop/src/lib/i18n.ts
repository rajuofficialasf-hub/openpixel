/**
 * Lightweight English / Bengali strings for the Desktop Studio shell.
 * Keeps tool names English while translating chrome and guidance.
 */
import type { Language } from './settings'

const EN: Record<string, string> = {
  'group.tools': 'Tools',
  'group.app': 'Engine & App',
  'nav.convert': 'Convert Image',
  'nav.batch': 'Batch Convert',
  'nav.pdf': 'PDF, OCR & Docs',
  'nav.formats': 'Formats',
  'nav.settings': 'Settings',
  'nav.logs': 'Logs',
  'header.offline': '100% Offline',
  'header.offlineTip': 'Native Rust engine on this machine — no server, no upload, no account.',
  'header.toLight': 'Switch to light theme',
  'header.toDark': 'Switch to dark theme',
  'header.toBn': 'Switch to Bengali',
  'header.toEn': 'Switch to English',
  'header.expand': 'Expand sidebar',
  'header.collapse': 'Collapse sidebar',
  'footer.native': 'OpenPixel Studio Desktop (Tauri 2 + native Rust engine) · 100% offline',
  'step.upload': '1. Choose file',
  'step.options': '2. Set options',
  'step.save': '3. Save result',
  'pdf.searchPlaceholder': 'Search PDF, OCR & Document tools…',
  'pdf.noMatch': 'No tools match that search.',
  'pdf.backAll': 'All PDF, OCR & Doc tools',
}

const BN: Record<string, string> = {
  'group.tools': 'টুলসমূহ',
  'group.app': 'ইঞ্জিন ও অ্যাপ',
  'nav.convert': 'Convert Image',
  'nav.batch': 'Batch Convert',
  'nav.pdf': 'PDF, OCR ও ডকুমেন্ট',
  'nav.formats': 'ফরম্যাট',
  'nav.settings': 'সেটিংস',
  'nav.logs': 'লগ',
  'header.offline': '১০০% অফলাইন',
  'header.offlineTip': 'আপনার কম্পিউটারেই নেটিভ Rust ইঞ্জিন চলে — কোনো সার্ভার, আপলোড বা অ্যাকাউন্ট নেই।',
  'header.toLight': 'লাইট থিমে যান',
  'header.toDark': 'ডার্ক থিমে যান',
  'header.toBn': 'ভাষা বাংলায় বদলান',
  'header.toEn': 'ভাষা ইংরেজিতে বদলান',
  'header.expand': 'সাইডবার বড় করুন',
  'header.collapse': 'সাইডবার ছোট করুন',
  'footer.native': 'OpenPixel Studio ডেস্কটপ (Tauri 2 + নেটিভ Rust ইঞ্জিন) · ১০০% অফলাইন',
  'step.upload': '১. ফাইল বাছাই',
  'step.options': '২. অপশন ঠিক করুন',
  'step.save': '৩. সেভ করুন',
  'pdf.searchPlaceholder': 'PDF, OCR বা ডকুমেন্ট টুল খুঁজুন…',
  'pdf.noMatch': 'কোনো মিল পাওয়া যায়নি।',
  'pdf.backAll': 'সব PDF, OCR ও ডকুমেন্ট টুল',
}

export function dt(lang: Language, key: string): string {
  return (lang === 'bn' ? BN[key] : undefined) ?? EN[key] ?? key
}
