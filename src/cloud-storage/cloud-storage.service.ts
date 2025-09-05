import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CloudStorageService {
  private s3: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    this.bucket = this.configService.get<string>('CLOUD_RU_BUCKET_NAME') || '';
    this.s3 = new S3Client({
      region: 'ru-central1', // регион Cloud.ru
      endpoint: 'https://s3.cloud.ru', // endpoint Cloud.ru
      credentials: {
        accessKeyId:
          this.configService.get<string>('CLOUD_RU_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('CLOUD_RU_SECRET_ACCESS_KEY') || '',
      },
      forcePathStyle: true, // важно для Cloud.ru
    });
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const key = `uploads/${Date.now()}-${file.originalname}`;

    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read', // чтобы файл был доступен по URL
    };

    try {
      await this.s3.send(new PutObjectCommand(params));
      return `https://${this.bucket}.s3.cloud.ru/${key}`; // итоговый URL файла
    } catch (err) {
      console.error(err);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async uploadFiles(files: Express.Multer.File[]): Promise<string[]> {
    const uploads = files.map((file) => {
      const key = `uploads/${uuidv4()}-${file.originalname}`;

      const params: PutObjectCommandInput = {
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      };

      return this.s3
        .send(new PutObjectCommand(params))
        .then(() => `https://${this.bucket}.s3.cloud.ru/${key}`);
    });

    try {
      return await Promise.all(uploads);
    } catch (err) {
      console.error('Ошибка при загрузке файлов в Selectel:', err);
      throw new InternalServerErrorException('Не удалось загрузить файлы');
    }
  }
}
