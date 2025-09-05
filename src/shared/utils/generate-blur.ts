import axios from 'axios';
import sharp from 'sharp';

export async function generateBlurDataURL(url: string): Promise<string> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    const resized = await sharp(buffer).resize(10).toFormat('webp').toBuffer();

    return `data:image/webp;base64,${resized.toString('base64')}`;
  } catch (err) {
    console.error(`❌ Failed to generate blurDataURL for ${url}`, err.message);
    return ''; // fallback если изображение битое
  }
}
