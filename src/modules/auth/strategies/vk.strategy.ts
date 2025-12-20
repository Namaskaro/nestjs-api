import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-vkontakte';

@Injectable()
export class VkStrategy extends PassportStrategy(Strategy, 'vkontakte') {
  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.get<string>('VK_CLIENT_ID')!,
      clientSecret: config.get<string>('VK_CLIENT_SECRET')!,
      callbackURL: `${config.get<string>('SERVER_URL')}/auth/vk/callback`,
      scope: ['email'],
      profileFields: ['id', 'first_name', 'last_name', 'photo_200'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    params: any,
    profile: any,
    done,
  ) {
    const email = params?.email ?? null;
    const name =
      [profile?.name?.givenName, profile?.name?.familyName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Не указано';
    const picture = profile?.photos?.[0]?.value ?? null;

    done(null, {
      email,
      name,
      picture,
      provider: 'vk',
      providerAccountId: String(profile?.id),
    });
  }
}
