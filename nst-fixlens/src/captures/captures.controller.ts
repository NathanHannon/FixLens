import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Get,
  Header,
} from '@nestjs/common';
import { CurrentUser } from '../common/demo-user.js';
import type { ActingUser } from '../common/demo-user.js';
import { RegisterCaptureDto } from './capture.dto.js';
import { CapturesService } from './captures.service.js';
@Controller('problems/:id/captures')
export class CapturesController {
  constructor(private readonly captures: CapturesService) {}
  @Get(':captureId/media')
  @Header('Cache-Control', 'no-store')
  media(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('captureId', ParseUUIDPipe) captureId: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.captures.media(id, captureId, user.id);
  }
  @Post('upload-url') upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.captures.upload(id, user.id);
  }
  @Post() register(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
    @Body() dto: RegisterCaptureDto,
  ) {
    return this.captures.register(id, user.id, dto);
  }
}
