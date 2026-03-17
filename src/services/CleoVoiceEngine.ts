import { playAudioFromBase64 } from '../../modules/expo-music-kit';
import { API_BASE_URL } from './api';

/**
 * Artist name pronunciation map.
 * ElevenLabs mispronounces many artist names — these aliases
 * guide the TTS to the correct pronunciation.
 * Add new entries as you catch mispronunciations.
 */
const PRONUNCIATION: Record<string, string> = {
  'Playboi Carti': 'Play-boy Car-tee',
  '6LACK': 'Black',
  'SZA': 'Sizza',
  'Migos': 'Mee-gos',
  'Lil Uzi Vert': 'Lil Oozy Vert',
  'Jhené Aiko': 'Juh-nay Eye-ko',
  'Doja Cat': 'Doe-jah Cat',
  'Quavo': 'Kwah-vo',
  'YoungBoy': 'Young Boy',
  'NBA YoungBoy': 'N-B-A Young Boy',
  'DaBaby': 'Dah Baby',
  'Gunna': 'Gun-nuh',
  'Latto': 'Lat-oh',
  'Boosie Badazz': 'Boo-see Bad-azz',
  'Boosie': 'Boo-see',
  'Brent Faiyaz': 'Brent Fay-yazz',
  'Gucci Mane': 'Goo-chi Mayne',
  'Megan Thee Stallion': 'Megan Thee Stallion',
  'Saweetie': 'Suh-wee-tee',
  'Polo G': 'Polo Gee',
  'Kodak Black': 'Kodak Black',
  'Lil Durk': 'Lil Durk',
  'Lil Tjay': 'Lil Tee-jay',
  'Yeat': 'Yeet',
  'Rae Sremmurd': 'Ray Shrem-urd',
  'Denzel Curry': 'Den-zel Curry',
  'JID': 'Jay Eye Dee',
  'H.E.R.': 'Her',
  'PARTYNEXTDOOR': 'Party Next Door',
  'Ty Dolla $ign': 'Tie Dolla Sign',
  'Ty Dolla Sign': 'Tie Dolla Sign',
  'XXXTENTACION': 'Ex-ex-ex-ten-tah-see-on',
  'Juice WRLD': 'Juice World',
  'Trippie Redd': 'Trippy Red',
  'Moneybagg Yo': 'Money Bag Yo',
  'NLE Choppa': 'N-L-E Choppa',
  'Lil Tecca': 'Lil Teck-ah',
  'Cordae': 'Cor-day',
  'Bas': 'Boz',
  'GloRilla': 'Glo-Rilla',
  'Glorilla': 'Glo-Rilla',
  'Sexyy Red': 'Sexy Red',
  'Doechii': 'Doe-chee',
  'Tyla': 'Tie-lah',
  'Rema': 'Ray-mah',
  'Burna Boy': 'Burna Boy',
  'Wizkid': 'Wiz Kid',
  'Tekno': 'Tek-no',
  'Tiwa Savage': 'Tee-wah Savage',
  'Davido': 'Dah-vee-doh',
  'Tems': 'Tems',
  'Gyakie': 'Jah-kee',
  'Ayra Starr': 'Eye-rah Star',
};

function applyPronunciation(text: string): string {
  let result = text;
  // Sort by length descending so longer names match first (e.g., "NBA YoungBoy" before "YoungBoy")
  const sorted = Object.entries(PRONUNCIATION).sort((a, b) => b[0].length - a[0].length);
  for (const [name, phonetic] of sorted) {
    result = result.replaceAll(name, phonetic);
  }
  return result;
}

/**
 * Post-process Gemini output for natural ElevenLabs delivery.
 * Em-dashes signal a beat/pause. Ellipses trail off naturally.
 * Strips quotation marks and stage directions.
 */
function formatForSpeech(text: string): string {
  return applyPronunciation(text)
    // Remove any stray quotation marks
    .replace(/["""]/g, '')
    // Remove stage directions like (pause) or [beat]
    .replace(/[\(\[][^\)\]]{1,20}[\)\]]/g, '')
    // Comma before "and/but/so" at clause boundary → em-dash for stronger pause
    .replace(/, (and|but|so) /g, ' — $1 ')
    // Clean up any double spaces
    .replace(/  +/g, ' ')
    .trim();
}

export async function synthesizeAndPlay(text: string): Promise<void> {
  try {
    const formatted = formatForSpeech(text);
    const wordCount = formatted.split(/\s+/).length;
    console.log(`[CleoVoice] Sending ${wordCount} words (${formatted.length} chars) to TTS: "${formatted.substring(0, 80)}..."`);

    const response = await fetch(`${API_BASE_URL}/synthesize-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatted }),
    });

    if (!response.ok) {
      throw new Error(`TTS error: ${response.status}`);
    }

    const data = await response.json();
    const base64Audio = data.audioContent;

    if (!base64Audio) {
      throw new Error('No audio content returned');
    }

    const audioSizeKB = Math.round((base64Audio.length * 3 / 4) / 1024);
    console.log(`[CleoVoice] Audio received: ${audioSizeKB}KB`);

    await playAudioFromBase64(base64Audio);
    console.log(`[CleoVoice] Playback finished`);
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}
