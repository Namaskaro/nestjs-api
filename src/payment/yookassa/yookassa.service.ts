import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

type YookassaPaymentStatus =
  | 'pending'
  | 'waiting_for_capture'
  | 'succeeded'
  | 'canceled';

interface CreateYookassaPaymentParams {
  orderId: string;
  amount: number;
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

@Injectable()
export class YookassaService {
  private readonly apiUrl = 'https://api.yookassa.ru/v3';

  public constructor(private readonly configService: ConfigService) {}

  public async createPayment({
    orderId,
    amount,
  }: CreateYookassaPaymentParams): Promise<YookassaPaymentResponse> {
    const clientUrl = this.configService.getOrThrow<string>('CLIENT_URL');

    const returnUrl = new URL('/checkout/payment-result', clientUrl);

    returnUrl.searchParams.set('orderId', orderId);

    const response = await fetch(`${this.apiUrl}/payments`, {
      method: 'POST',

      headers: {
        Authorization: this.getAuthorizationHeader(),

        'Idempotence-Key': randomUUID(),

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

    return this.parseResponse(response);
  }

  // NEW
  public async getPayment(
    providerPaymentId: string,
  ): Promise<YookassaPaymentResponse> {
    const response = await fetch(
      `${this.apiUrl}/payments/${providerPaymentId}`,
      {
        method: 'GET',

        headers: {
          Authorization: this.getAuthorizationHeader(),

          'Content-Type': 'application/json',
        },
      },
    );

    return this.parseResponse(response);
  }

  private getAuthorizationHeader() {
    const shopId = this.configService.getOrThrow<string>('YOOKASSA_SHOP_ID');

    const secretKey = this.configService.getOrThrow<string>(
      'YOOKASSA_SECRET_KEY',
    );

    const authorization = Buffer.from(`${shopId}:${secretKey}`).toString(
      'base64',
    );

    return `Basic ${authorization}`;
  }

  private async parseResponse(
    response: Response,
  ): Promise<YookassaPaymentResponse> {
    const body = await response.json();

    if (!response.ok) {
      throw new BadGatewayException({
        message: 'Ошибка запроса к ЮKassa',

        yookassa: body,
      });
    }

    return body as YookassaPaymentResponse;
  }
}
