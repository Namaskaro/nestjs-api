import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

type YookassaPaymentStatus =
  | 'pending'
  | 'waiting_for_capture'
  | 'succeeded'
  | 'canceled';

export type YookassaRefundStatus = 'pending' | 'succeeded' | 'canceled';

interface CreateYookassaPaymentParams {
  orderId: string;
  amount: number;
  idempotenceKey: string;
}

interface CreateFullRefundParams {
  providerPaymentId: string;
  amount: number;
  idempotenceKey: string;
}

export interface YookassaPaymentResponse {
  id: string;
  status: YookassaPaymentStatus;
  paid: boolean;

  amount: {
    value: string;
    currency: string;
  };

  confirmation?: {
    type: string;
    return_url?: string;
    confirmation_url?: string;
  };

  metadata?: Record<string, string>;

  cancellation_details?: {
    party: string;
    reason: string;
  };

  created_at: string;
  test: boolean;
}

export interface YookassaRefundResponse {
  id: string;
  payment_id: string;
  status: YookassaRefundStatus;

  amount: {
    value: string;
    currency: string;
  };

  created_at: string;

  cancellation_details?: {
    party: string;
    reason: string;
  };

  metadata?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 20_000;

@Injectable()
export class YookassaService {
  private readonly logger = new Logger(YookassaService.name);

  private readonly apiUrl = 'https://api.yookassa.ru/v3';

  constructor(private readonly configService: ConfigService) {}

  public async createPayment({
    orderId,
    amount,
    idempotenceKey,
  }: CreateYookassaPaymentParams): Promise<YookassaPaymentResponse> {
    const clientUrl = this.configService.getOrThrow<string>('CLIENT_URL');

    const returnUrl = new URL('/checkout/payment-result', clientUrl);

    returnUrl.searchParams.set('orderId', orderId);

    return this.request<YookassaPaymentResponse>('/payments', {
      method: 'POST',

      headers: {
        Authorization: this.getAuthorizationHeader(),
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        amount: {
          value: amount.toFixed(2),
          currency: 'RUB',
        },

        capture: true,

        payment_method_data: {
          type: 'bank_card',
        },

        confirmation: {
          type: 'redirect',
          return_url: returnUrl.toString(),
        },

        description: `Оплата заказа ${orderId}`,

        metadata: {
          orderId,
        },
      }),
    });
  }

  public async getPayment(
    providerPaymentId: string,
  ): Promise<YookassaPaymentResponse> {
    return this.request<YookassaPaymentResponse>(
      `/payments/${encodeURIComponent(providerPaymentId)}`,
      {
        method: 'GET',

        headers: {
          Authorization: this.getAuthorizationHeader(),
          'Content-Type': 'application/json',
        },
      },
    );
  }

  public async createFullRefund({
    providerPaymentId,
    amount,
    idempotenceKey,
  }: CreateFullRefundParams): Promise<YookassaRefundResponse> {
    if (!providerPaymentId.trim()) {
      throw new BadRequestException('Не указан исходный платёж.');
    }

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException('Некорректная сумма возврата.');
    }

    if (!idempotenceKey || idempotenceKey.length > 64) {
      throw new BadRequestException('Некорректный ключ идемпотентности.');
    }

    return this.request<YookassaRefundResponse>('/refunds', {
      method: 'POST',

      headers: {
        Authorization: this.getAuthorizationHeader(),
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        payment_id: providerPaymentId,

        amount: {
          value: amount.toFixed(2),
          currency: 'RUB',
        },
      }),
    });
  }

  public async getRefund(
    providerRefundId: string,
  ): Promise<YookassaRefundResponse> {
    if (!providerRefundId.trim()) {
      throw new BadRequestException('Не указан идентификатор возврата.');
    }

    return this.request<YookassaRefundResponse>(
      `/refunds/${encodeURIComponent(providerRefundId)}`,
      {
        method: 'GET',

        headers: {
          Authorization: this.getAuthorizationHeader(),
          'Content-Type': 'application/json',
        },
      },
    );
  }

  private getAuthorizationHeader(): string {
    const shopId = this.configService.getOrThrow<string>('YOOKASSA_SHOP_ID');

    const secretKey = this.configService.getOrThrow<string>(
      'YOOKASSA_SECRET_KEY',
    );

    const authorization = Buffer.from(`${shopId}:${secretKey}`).toString(
      'base64',
    );

    return `Basic ${authorization}`;
  }

  private async request<T>(path: string, options: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const cause =
        error instanceof Error && 'cause' in error ? error.cause : undefined;

      const networkError =
        cause instanceof Error ? cause : error instanceof Error ? error : null;

      const code =
        networkError &&
        'code' in networkError &&
        typeof networkError.code === 'string'
          ? networkError.code
          : 'UNKNOWN';

      this.logger.error(
        `Ошибка соединения с YooKassa: ${path}; ` +
          `code=${code}; ` +
          `message=${networkError?.message ?? 'Unknown error'}`,
      );

      throw new BadGatewayException(
        'Не удалось подключиться к ЮKassa. ' +
          'Попытка оплаты сохранена. ' +
          'Повторите операцию позже.',
      );
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new BadGatewayException('ЮKassa вернула некорректный ответ.');
    }

    if (!response.ok) {
      this.logger.error(`YooKassa API error: HTTP ${response.status}`);

      throw new BadGatewayException({
        message: 'Ошибка запроса к ЮKassa',
        yookassa: body,
      });
    }

    return body as T;
  }
}
