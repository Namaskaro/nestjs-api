import 'express-session';

declare module 'express-session' {
  interface SessionData {
    guestId?: string; // добавляем свойство guestId
  }
}

declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}
