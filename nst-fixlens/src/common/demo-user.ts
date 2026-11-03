import {
  CanActivate,
  ExecutionContext,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
export interface ActingUser {
  id: string;
}
@Injectable()
export class DemoUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: ActingUser }>().user = {
      id: DEMO_USER_ID,
    };
    return true;
  }
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActingUser =>
    context.switchToHttp().getRequest<{ user: ActingUser }>().user,
);
