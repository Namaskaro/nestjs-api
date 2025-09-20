import { Injectable } from '@nestjs/common';
import { ensureDir, outputFile } from 'fs-extra';

import { join } from 'path';
import { path as appRootPath } from 'app-root-path';

type FileResponse = { url: string; name: string };

@Injectable()
export class FileService {
  async saveFiles(files: Express.Multer.File[], folder = 'products') {
    const uploadedFolder = join(appRootPath, 'uploads', folder);
    await ensureDir(uploadedFolder);

    const response: FileResponse[] = await Promise.all(
      files.map(async (file) => {
        const originalName = `${crypto.randomUUID()}-${file.originalname}`;
        await outputFile(
          join(uploadedFolder, originalName),
          file.buffer as unknown as Uint8Array,
        ); // <-- Buffer ок
        return {
          url: `/uploads/${folder}/${originalName}`,
          name: originalName,
        };
      }),
    );

    return response;
  }
}

// @Injectable()
// export class FileService {
//   // eslint-disable-next-line @typescript-eslint/no-inferrable-types
//   async saveFiles(files: Express.Multer.File[], folder: string = 'products') {
//     const uploadedFolder = `${path}/uploads/${folder}`;

//     await ensureDir(uploadedFolder);

//     const response: FileResponse[] = await Promise.all(
//       files.map(async (file) => {
//         const originalName = `${crypto.randomUUID()}-${file.originalname}`;

//         await writeFile(`${uploadedFolder}/${originalName}`, file.buffer);

//         return {
//           url: `/uploads/${folder}/${originalName}`,
//           name: originalName,
//         };
//       }),
//     );
//     return response;
//   }
// }
