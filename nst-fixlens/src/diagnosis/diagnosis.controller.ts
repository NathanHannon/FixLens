import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../common/demo-user.js';
import type { ActingUser } from '../common/demo-user.js';
import { DiagnoseDto, EditMaskDto, SegmentDto } from './diagnosis.dto.js';
import { DiagnosisService } from './diagnosis.service.js';
@Controller('problems/:id')
export class DiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}
  @Post('mask-edits') editMask(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
    @Body() dto: EditMaskDto,
  ) {
    return this.diagnosis.editMask(id, user.id, dto);
  }
  @Post('segment') segment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
    @Body() dto: SegmentDto,
  ) {
    return this.diagnosis.segment(id, user.id, dto);
  }
  @Post('diagnose') diagnose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
    @Body() dto: DiagnoseDto,
  ) {
    return this.diagnosis.diagnose(id, user.id, dto);
  }
}
