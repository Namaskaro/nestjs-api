import {
  BadGatewayException,
  BadRequestException,
  Injectable,
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

@Injectable()
export class YookassaService {
  private readonly apiUrl = 'https://api.yookassa.ru/v3';

  public constructor(private readonly configService: ConfigService) {}

  public async createPayment({
    orderId,
    amount,
    idempotenceKey,
  }: CreateYookassaPaymentParams): Promise<YookassaPaymentResponse> {
    const clientUrl = this.configService.getOrThrow<string>('CLIENT_URL');

    const returnUrl = new URL('/checkout/payment-result', clientUrl);

    returnUrl.searchParams.set('orderId', orderId);

    const response = await fetch(`${this.apiUrl}/payments`, {
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

    return this.parseResponse<YookassaPaymentResponse>(response);
  }

  public async getPayment(
    providerPaymentId: string,
  ): Promise<YookassaPaymentResponse> {
    const response = await fetch(
      `${this.apiUrl}/payments/${encodeURIComponent(providerPaymentId)}`,
      {
        method: 'GET',

        headers: {
          Authorization: this.getAuthorizationHeader(),

          'Content-Type': 'application/json',
        },
      },
    );

    return this.parseResponse<YookassaPaymentResponse>(response);
  }

  /**
   * Создание ПОЛНОГО возврата.
   *
   * Метод вызывается только серверным
   * сервисом возвратов после проверки заказа.
   *
   * amount — полная сумма исходного платежа
   * в рублях, полученная из доверенной БД.
   *
   * idempotenceKey создаётся и сохраняется
   * вызывающим сервисом ДО внешнего запроса.
   *
   * Метод не генерирует случайный ключ:
   * повтор финансовой операции должен
   * использовать тот же ключ.
   */
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

    const response = await fetch(`${this.apiUrl}/refunds`, {
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

    return this.parseResponse<YookassaRefundResponse>(response);
  }

  /**
   * Получение актуального состояния возврата.
   *
   * Используется для проверки операции,
   * которая уже была отправлена в ЮKassa.
   *
   * GET не инициирует новый возврат.
   */
  public async getRefund(
    providerRefundId: string,
  ): Promise<YookassaRefundResponse> {
    if (!providerRefundId.trim()) {
      throw new BadRequestException('Не указан идентификатор возврата.');
    }

    const response = await fetch(
      `${this.apiUrl}/refunds/${encodeURIComponent(providerRefundId)}`,
      {
        method: 'GET',

        headers: {
          Authorization: this.getAuthorizationHeader(),

          'Content-Type': 'application/json',
        },
      },
    );

    return this.parseResponse<YookassaRefundResponse>(response);
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

  private async parseResponse<T>(response: Response): Promise<T> {
    const body: unknown = await response.json();

    if (!response.ok) {
      throw new BadGatewayException({
        message: 'Ошибка запроса к ЮKassa',
        yookassa: body,
      });
    }

    return body as T;
  }
}
