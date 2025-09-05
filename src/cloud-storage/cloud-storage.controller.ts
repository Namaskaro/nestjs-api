import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CloudStorageService } from './cloud-storage.service';

@Controller('cloud')
export class CloudStorageController {
  constructor(private readonly cloudStorageService: CloudStorageService) {}

  @Post('/images')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: 5 * 1024 * 1024 }, // макс. размер 5MB на файл
    }),
  )
  async upload(@UploadedFiles() files: Express.Multer.File[]) {
    const uploadResults = await Promise.all(
      files.map(async (file) => {
        return this.cloudStorageService.uploadFile(file);
      }),
    );

    return { urls: uploadResults };
  }
}
