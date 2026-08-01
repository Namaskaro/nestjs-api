import { Body, Heading, Html, Text } from '@react-email/components';
import * as React from 'react';

interface TwoFactorAuthTemplateProps {
  token: string;
}

export function TwoFactorAuthTemplate({ token }: TwoFactorAuthTemplateProps) {
  return (
    <Html>
      <Body>
        <Heading>Двухфакторная аутентификация</Heading>
        <Text>
          Ваш код двухфакторной аутентификаиции: <strong>{token}</strong>
        </Text>
        <Text>
          Введите этот код в приложении для завершения процесса аутентификаиции.
        </Text>
        <Text>
          Если вы не запрашивали этот код, просто проигнорируйте это сообщение!
        </Text>
      </Body>
    </Html>
  );
}
