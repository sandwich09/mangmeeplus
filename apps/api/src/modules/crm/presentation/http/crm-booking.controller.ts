import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, CreateCrmBookingInput, UpdateCrmBookingInput, CrmBookingAvailabilityQuery, UpdateCrmBookingSettingsInput } from '@watchdog-bms/contracts';
import {
  GetCrmBookingSettingsUseCase,
  UpdateCrmBookingSettingsUseCase,
  ListCrmBookingsUseCase,
  ListCrmCustomerBookingsUseCase,
  CreateCrmBookingUseCase,
  UpdateCrmBookingUseCase,
  CancelCrmBookingUseCase,
} from '../../application/use-cases/crm-booking.use-case';

@ApiTags('crm')
@Controller('companies/:companyId/crm/bookings')
export class CrmBookingController {
  constructor(
    private readonly getSettings: GetCrmBookingSettingsUseCase,
    private readonly updateSettings: UpdateCrmBookingSettingsUseCase,
    private readonly listBookings: ListCrmBookingsUseCase,
    private readonly listCustomerBookings: ListCrmCustomerBookingsUseCase,
    private readonly createBooking: CreateCrmBookingUseCase,
    private readonly updateBooking: UpdateCrmBookingUseCase,
    private readonly cancelBooking: CancelCrmBookingUseCase,
  ) {}

  @Get('settings')
  @RequirePermissions('crm.booking.read')
  @ApiOperation({ summary: 'Get company booking buffer settings' })
  settings(@ReqCtx() ctx: RequestContext) {
    return this.getSettings.execute(ctx);
  }

  @Patch('settings')
  @RequirePermissions('crm.booking.update')
  @ApiOperation({ summary: 'Update company booking buffer settings' })
  updateSettingsValue(@ReqCtx() ctx: RequestContext, @Body() body: UpdateCrmBookingSettingsInput) {
    return this.updateSettings.execute(ctx, body);
  }

  @Get()
  @RequirePermissions('crm.booking.read')
  @ApiOperation({ summary: 'List bookings for the Bangkok ISO week containing weekStart (Sunday-start)' })
  list(@ReqCtx() ctx: RequestContext, @Query('branchId') branchId?: string, @Query('weekStart') weekStart?: string) {
    return this.listBookings.execute(ctx, { branchId, weekStart });
  }

  @Get('availability')
  @RequirePermissions('crm.booking.read')
  @ApiOperation({ summary: 'List free appointment start times for a staff member on a Bangkok date' })
  availability(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('branchId') branchId?: string,
    @Query('staffUserId') staffUserId?: string,
    @Query('date') date?: string,
    @Query('durationMinutes') durationMinutes?: string,
  ) {
    return this.listBookings.availability(ctx, companyId, { branchId, staffUserId, date, durationMinutes: Number(durationMinutes) } as CrmBookingAvailabilityQuery);
  }

  @Get('by-customer/:customerId')
  @RequirePermissions('crm.booking.read')
  @ApiOperation({ summary: 'List a customer\'s appointments (Customer 360 tab)' })
  byCustomer(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string) {
    return this.listCustomerBookings.execute(ctx, customerId);
  }

  @Post()
  @RequirePermissions('crm.booking.create')
  @ApiOperation({ summary: 'Create a booking' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmBookingInput) {
    return this.createBooking.execute(ctx, body);
  }

  @Patch(':bookingId')
  @RequirePermissions('crm.booking.update')
  @ApiOperation({ summary: 'Update a booking' })
  update(@ReqCtx() ctx: RequestContext, @Param('bookingId') bookingId: string, @Body() body: UpdateCrmBookingInput) {
    return this.updateBooking.execute(ctx, bookingId, body);
  }

  @Post(':bookingId/cancel')
  @RequirePermissions('crm.booking.cancel')
  @ApiOperation({ summary: 'Cancel a booking' })
  cancel(@ReqCtx() ctx: RequestContext, @Param('bookingId') bookingId: string) {
    return this.cancelBooking.execute(ctx, bookingId);
  }
}
