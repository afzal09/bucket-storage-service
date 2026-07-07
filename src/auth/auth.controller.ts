import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAccessKeyDto, AccessKeyDto } from './dto/access-key.dto';
import { SignatureGuard } from './guards/signature.guard';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator';
import { Principal } from '../common/interfaces/principal.interface';

@Controller('auth/keys')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Deliberately NOT behind SignatureGuard — this is the bootstrap
   * operation that gets an owner their first access key. In production
   * this endpoint would sit behind whatever upstream identity system
   * issues ownerIds (e.g. AlaanPay's JWT/corporateId flow), not be open
   * to self-registration as drafted here for local dev.
   */
  @Post()
  async createAccessKey(@Body() dto: CreateAccessKeyDto): Promise<AccessKeyDto> {
    return this.authService.generateAccessKey(dto.ownerId);
  }

  @Delete(':accessKeyId')
  @UseGuards(SignatureGuard)
  async revokeAccessKey(
    @Param('accessKeyId') accessKeyId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    return this.authService.revokeAccessKey(accessKeyId, principal);
  }
}
