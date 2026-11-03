import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Delete,
  HttpCode,
  Header,
} from '@nestjs/common';
import { CurrentUser } from '../common/demo-user.js';
import type { ActingUser } from '../common/demo-user.js';
import { CreateProblemDto } from './problem.dto.js';
import { ProblemsService } from './problems.service.js';
import { ProblemDeletionService } from './problem-deletion.service.js';
@Controller('problems')
export class ProblemsController {
  constructor(
    private readonly problems: ProblemsService,
    private readonly deletion: ProblemDeletionService,
  ) {}
  @Delete(':id') @HttpCode(202) remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.deletion.remove(id, user.id);
  }
  @Get(':id/storage') files(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.deletion.files(id, user.id);
  }
  @Delete(':id/previews') clearPreviews(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.deletion.clearPreviews(id, user.id);
  }
  @Post() create(
    @CurrentUser() user: ActingUser,
    @Body() dto: CreateProblemDto,
  ) {
    return this.problems.create(user.id, dto);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: ActingUser) {
    return this.problems.list(user.id);
  }
  @Get(':id') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.problems.detail(id, user.id);
  }
  @Get(':id/deltas') deltas(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.problems.deltas(id, user.id);
  }
}
