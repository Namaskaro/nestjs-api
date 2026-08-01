import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientDuplexStream,
  credentials,
  Metadata,
  ServiceError,
} from '@grpc/grpc-js';
import { stt, sttService } from '@yandex-cloud/nodejs-sdk/ai-stt-v3';

export interface SpeechFinalResult {
  segmentId: number;
  text: string;
}

interface StartSpeechSessionOptions {
  onPartial: (text: string) => void;
  onFinal: (result: SpeechFinalResult) => void;
  onError: (error: Error) => void;
  onClose?: () => void;
}

interface PendingFinal {
  segmentId: number;
  rawText: string;
  committed: boolean;
}

interface SpeechSession {
  stream: ClientDuplexStream<stt.StreamingRequest, stt.StreamingResponse>;
  nextSegmentId: number;
  pendingFinals: PendingFinal[];
  active: boolean;
  stopping: boolean;
  closed: boolean;
}

@Injectable()
export class SpeechService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeechService.name);
  private readonly sessions = new Map<string, SpeechSession>();

  private readonly recognizer = new sttService.RecognizerClient(
    'stt.api.cloud.yandex.net:443',
    credentials.createSsl(),
  );

  constructor(private readonly configService: ConfigService) {}

  startSession(clientId: string, options: StartSpeechSessionOptions): void {
    this.cancelExistingSession(clientId);

    const apiKey = this.configService.getOrThrow<string>(
      'YANDEX_SPEECHKIT_API_KEY',
    );

    const metadata = new Metadata();
    metadata.set('authorization', `Api-Key ${apiKey}`);

    const stream = this.recognizer.recognizeStreaming(metadata);

    const session: SpeechSession = {
      stream,
      nextSegmentId: 0,
      pendingFinals: [],
      active: true,
      stopping: false,
      closed: false,
    };

    this.sessions.set(clientId, session);

    stream.on('data', (response: stt.StreamingResponse) => {
      this.handleResponse(session, response, options);
    });

    stream.on('error', (error: ServiceError) => {
      if (session.closed) return;
      session.active = false;
      session.closed = true;
      this.deleteSession(clientId, session);
      this.logger.error(`SpeechKit error for ${clientId}: ${error.message}`);
      options.onError(new Error(error.message));
    });

    stream.on('end', () => this.finishSession(clientId, session, options));
    stream.on('close', () => this.finishSession(clientId, session, options));

    const configRequest: stt.StreamingRequest = {
      sessionOptions: {
        recognitionModel: {
          model: 'general',

          audioFormat: {
            rawAudio: {
              audioEncoding: stt.RawAudio_AudioEncoding.LINEAR16_PCM,

              sampleRateHertz: 16000,
              audioChannelCount: 1,
            },
          },

          textNormalization: {
            textNormalization:
              stt.TextNormalizationOptions_TextNormalization
                .TEXT_NORMALIZATION_ENABLED,

            profanityFilter: false,
            literatureText: true,

            phoneFormattingMode:
              stt.TextNormalizationOptions_PhoneFormattingMode
                .PHONE_FORMATTING_MODE_DISABLED,
          },

          languageRestriction: {
            restrictionType:
              stt.LanguageRestrictionOptions_LanguageRestrictionType.WHITELIST,

            languageCode: ['ru-RU'],
          },

          audioProcessingType:
            stt.RecognitionModelOptions_AudioProcessingType.REAL_TIME,
        },

        /*
         * После паузы SpeechKit завершает текущую фразу
         * и начинает распознавать следующую отдельно.
         */
        eouClassifier: {
          defaultClassifier: {
            type: stt.DefaultEouClassifier_EouSensitivity.HIGH,

            maxPauseBetweenWordsHintMs: 1200,
          },
        },
      },
    };

    stream.write(configRequest);
    this.logger.log(`SpeechKit session started for ${clientId}`);
  }

  writeAudio(clientId: string, audioChunk: Buffer): void {
    const session = this.sessions.get(clientId);
    if (!session || !session.active) {
      throw new Error(`Speech session is not started for client ${clientId}`);
    }
    if (session.stopping || audioChunk.length === 0) return;

    const audioRequest: stt.StreamingRequest = {
      chunk: { data: audioChunk },
    };
    session.stream.write(audioRequest);
  }

  stopSession(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (!session || !session.active || session.stopping) return;
    session.stopping = true;
    session.stream.end();
    this.logger.log(`SpeechKit session stopping for ${clientId}`);
  }

 

  private handleResponse(
    session: SpeechSession,
    response: stt.StreamingResponse,
    options: StartSpeechSessionOptions,
  ): void {
    if (!session.active || session.closed) {
      return;
    }

    const partialText = response.partial?.alternatives[0]?.text?.trim();

    const rawFinalText = response.final?.alternatives[0]?.text?.trim();

    const normalizedText =
      response.finalRefinement?.normalizedText?.alternatives[0]?.text?.trim();

    console.log('[SpeechService response]', {
      partialText,
      rawFinalText,
      normalizedText,

      finalIndex: response.finalRefinement?.finalIndex?.toString(),

      pendingFinals: session.pendingFinals.map(({ segmentId, rawText }) => ({
        segmentId,
        rawText,
      })),
    });

    /*
     * Текущая промежуточная гипотеза.
     * Отправляем на frontend для серого текста.
     */
    if (partialText) {
      options.onPartial(partialText);
    }

    /*
     * Сырой final на frontend не отправляем.
     *
     * Создаём локальный segmentId и ждём
     * соответствующий finalRefinement.
     */
    if (rawFinalText) {
      const pendingFinal: PendingFinal = {
        segmentId: session.nextSegmentId,
        rawText: rawFinalText,
        committed: false,
      };

      session.nextSegmentId += 1;
      session.pendingFinals.push(pendingFinal);

      this.logger.debug(
        `Pending final [${pendingFinal.segmentId}]: ${rawFinalText}`,
      );
    }

    /*
     * Нормализованный результат:
     * заглавные буквы, пунктуация и числа.
     */
    if (normalizedText) {
      const pendingFinal = session.pendingFinals.shift();

      if (!pendingFinal) {
        this.logger.warn(
          `Ignored finalRefinement without pending final: ${normalizedText}`,
        );

        return;
      }

      this.logger.debug(
        `Committed final [${pendingFinal.segmentId}]: ${normalizedText}`,
      );

      options.onFinal({
        segmentId: pendingFinal.segmentId,
        text: normalizedText,
      });
    }

    if (response.eouUpdate) {
      this.logger.debug(`EOU update: ${JSON.stringify(response.eouUpdate)}`);
    }

    if (response.statusCode?.message) {
      this.logger.debug(`SpeechKit status: ${response.statusCode.message}`);
    }
  }

  private finishSession(
    clientId: string,
    session: SpeechSession,
    options: StartSpeechSessionOptions,
  ): void {
    if (session.closed) return;

    for (const pending of session.pendingFinals) {
      if (!pending.committed) {
        options.onFinal({
          segmentId: pending.segmentId,
          text: pending.rawText,
        });
      }
    }

    session.active = false;
    session.closed = true;
    this.deleteSession(clientId, session);
    this.logger.log(`SpeechKit stream ended for ${clientId}`);
    options.onClose?.();
  }

  private cancelExistingSession(clientId: string): void {
    const existing = this.sessions.get(clientId);
    if (!existing) return;
    existing.active = false;
    existing.closed = true;
    this.sessions.delete(clientId);
    existing.stream.cancel();
  }

  private deleteSession(clientId: string, session: SpeechSession): void {
    if (this.sessions.get(clientId) === session) {
      this.sessions.delete(clientId);
    }
  }

  onModuleDestroy(): void {
    for (const session of this.sessions.values()) {
      session.active = false;
      session.closed = true;
      session.stream.cancel();
    }
    this.sessions.clear();
    this.recognizer.close();
  }
}
