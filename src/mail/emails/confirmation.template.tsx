import { Body, Heading, Html, Link, Text } from '@react-email/components';
import * as React from 'react';

interface ConfirmationTemplateProps {
  domain: string;
  token: string;
}

export function ConfirmationTemplate({
  domain,
  token,
}: ConfirmationTemplateProps) {
  const confirmLink = `${domain}/auth/verification?=${token}`;
  return (
    <Html>
      <Body>
        <Heading>Подтверждение почты</Heading>
        <Text>
          Чтобы подтвержить свой адрес электронной почты, пожалуйста перейдите
          по ссылке!
        </Text>
        <Link href={confirmLink}>Подтвердить почту</Link>
        <Text>
          Эта ссылка действительна в течение 1 часа. Если вы не запрашивали
          подтверждение, просто проигнорируйте это письмо!
        </Text>
      </Body>
    </Html>
  );
}
