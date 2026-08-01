import { Body, Heading, Html, Link, Text } from '@react-email/components';
import * as React from 'react';

interface ResetPasswordTemplateProps {
  domain: string;
  token: string;
}

export function ResetPasswordTemplate({
  domain,
  token,
}: ResetPasswordTemplateProps) {
  const confirmLink = `${domain}/auth/new-password?=token${token}`;
  return (
    <Html>
      <Body>
        <Heading>Сброс пароля</Heading>
        <Text>
          Здравствуйте! Вы запросили сброс пароля. Перейдите по ссылке чтобы
          создать новый пароль.
        </Text>
        <Link href={confirmLink}>Подтвердить сброс пароля</Link>
        <Text>
          Эта ссылка действительна в течение 1 часа. Если вы не запрашивали
          сброс пароля, просто проигнорируйте это сообщение!
        </Text>
      </Body>
    </Html>
  );
}
