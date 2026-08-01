import { ClientDuplexStream, ServiceError } from '@grpc/grpc-js';

export interface SpeechKitAlternative {
  text: string;
  confidence?: number;
}

export interface SpeechKitAlternativeUpdate {
  alternatives?: SpeechKitAlternative[];
}

export interface SpeechKitStreamingResponse {
  partial?: SpeechKitAlternativeUpdate;
  final?: SpeechKitAlternativeUpdate;

  finalRefinement?: {
    finalIndex?: number;
    normalizedText?: SpeechKitAlternativeUpdate;
  };

  statusCode?: {
    codeType?: string;
    message?: string;
  };
}

export interface SpeechKitStreamingRequest {
  sessionOptions?: {
    recognitionModel: {
      model: string;

      audioFormat: {
        rawAudio: {
          audioEncoding: string;
          sampleRateHertz: number;
          audioChannelCount: number;
        };
      };

      textNormalization: {
        textNormalization: string;
        profanityFilter: boolean;
        literatureText: boolean;
      };

      languageRestriction: {
        restrictionType: string;
        languageCode: string[];
      };

      audioProcessingType: string;
    };

    eouClassifier: {
      defaultClassifier: {
        type: string;
        maxPauseBetweenWordsHintMs: number;
      };
    };
  };

  chunk?: {
    data: Buffer;
  };
}

export type SpeechKitStream = ClientDuplexStream<
  SpeechKitStreamingRequest,
  SpeechKitStreamingResponse
>;

export interface SpeechSessionCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: ServiceError | Error) => void;
  onClose?: () => void;
}
