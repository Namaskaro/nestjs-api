import {
  Body,
  Heading,
  Html,
  Link,
  Text,
  Tailwind,
  Button,
  Container,
  Section,
  Column,
  Img,
} from '@react-email/components';
import * as React from 'react';

interface ConfirmationTemplateProps {
  domain: string;
  token: string;
}

export function InviteOperatorTemplate({
  domain,
  token,
}: ConfirmationTemplateProps) {
  const confirmLink = `${domain}/auth/operator/activate?token=${token}`;
  return (
    <Tailwind>
      <Html>
        <Body>
          <Container>
            <Section>
              <Column align="center">
                <Img
                  src="https://plus.unsplash.com/premium_photo-1661434914660-c68d9fd54753?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                  width={500}
                  height={250}
                />
              </Column>
              <Column align="center">
                <Heading>Приглашение менеджера</Heading>
                <Text>
                  Чтобы зарегистрировать рабочий аккаунт, перейдите по ссылке!
                </Text>
                <Link href={confirmLink}>
                  <Button className="rounded-md bg-black py-2 px-2 text-white">
                    К аккаунту
                  </Button>
                </Link>
                <Text>Эта ссылка действительна в течение 24 часов!</Text>
              </Column>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
}
