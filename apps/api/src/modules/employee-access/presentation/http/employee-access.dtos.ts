// HTTP-boundary validation for employee-access bodies. The @watchdog-bms/contracts
// types are compile-time only; these classes give the global ValidationPipe runtime
// metadata so unknown/mistyped fields are rejected at the edge (whitelist + forbidNonWhitelisted).
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { EMPLOYEE_TITLE_PREFIXES } from '@watchdog-bms/contracts';
import type {
  CreateEmployeeInput,
  CreateRoleInput,
  EmployeeIdentityType,
  EmployeeTitlePrefix,
  RolePreviewInput,
  SetEmployeeStatusInput,
  UpdateEmployeeInput,
  UpdateRoleInput,
} from '@watchdog-bms/contracts';

export class CreateEmployeeDto implements CreateEmployeeInput {
  @IsString() @IsNotEmpty() @MaxLength(40) @Matches(/^[a-zA-Z0-9._-]+$/) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) displayName!: string;
  // Bounded to the catalogue rather than free text, so nothing but a real คำนำหน้า can be stored.
  @IsIn(EMPLOYEE_TITLE_PREFIXES) @IsOptional() titlePrefix?: EmployeeTitlePrefix;
  @IsString() @IsOptional() @MaxLength(160) legalName?: string;
  @IsEmail() @IsOptional() @MaxLength(254) email?: string;
  @IsString() @IsOptional() @MaxLength(80) firstName?: string;
  @IsString() @IsOptional() @MaxLength(80) lastName?: string;
  @IsString() @IsOptional() @MaxLength(80) nickname?: string;
  @IsDateString() dateOfBirth!: string;
  @IsString() @IsOptional() @MaxLength(240) addressLine?: string;
  @IsString() @IsOptional() @MaxLength(10) postalCode?: string;
  @IsString() @IsOptional() @MaxLength(120) province?: string;
  @IsString() @IsOptional() @MaxLength(120) district?: string;
  @IsString() @IsOptional() @MaxLength(120) subdistrict?: string;
  @IsIn(['THAI_NATIONAL_ID', 'PASSPORT']) identityType!: EmployeeIdentityType;
  @IsString() @IsNotEmpty() @MaxLength(32) identityNumber!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) phoneNumber!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) roleIds!: string[];
  @IsBoolean() @IsOptional() linkExistingUser?: boolean;
}

export class UpdateEmployeeDto implements UpdateEmployeeInput {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(160) displayName?: string;
  @IsIn(EMPLOYEE_TITLE_PREFIXES) @IsOptional() titlePrefix?: EmployeeTitlePrefix;
  @IsString() @IsOptional() @MaxLength(160) legalName?: string;
  @IsEmail() @IsOptional() @MaxLength(254) email?: string;
  @IsString() @IsOptional() @MaxLength(80) firstName?: string;
  @IsString() @IsOptional() @MaxLength(80) lastName?: string;
  @IsString() @IsOptional() @MaxLength(80) nickname?: string | null;
  @IsDateString() @IsOptional() dateOfBirth?: string | null;
  @IsString() @IsOptional() @MaxLength(240) addressLine?: string | null;
  @IsString() @IsOptional() @MaxLength(10) postalCode?: string | null;
  @IsString() @IsOptional() @MaxLength(120) province?: string | null;
  @IsString() @IsOptional() @MaxLength(120) district?: string | null;
  @IsString() @IsOptional() @MaxLength(120) subdistrict?: string | null;
  @IsIn(['THAI_NATIONAL_ID', 'PASSPORT']) @IsOptional() identityType?: EmployeeIdentityType;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(32) identityNumber?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(20) phoneNumber?: string;
  @IsArray() @IsOptional() @ArrayNotEmpty() @IsString({ each: true }) roleIds?: string[];
  @IsIn(['ALL_BRANCHES', 'SELECTED_BRANCHES', 'DEFAULT_BRANCH_ONLY']) @IsOptional() branchScopeMode?: UpdateEmployeeInput['branchScopeMode'];
  @IsString() @IsOptional() defaultBranchId?: string | null;
  @IsArray() @IsOptional() @IsString({ each: true }) branchIds?: string[];
}

// status is optional at the boundary: the /disable endpoint defaults it to DISABLED.
export class SetEmployeeStatusDto implements Partial<SetEmployeeStatusInput> {
  @IsIn(['ACTIVE', 'SUSPENDED', 'DISABLED']) @IsOptional() status?: SetEmployeeStatusInput['status'];
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

export class CreateRoleDto implements CreateRoleInput {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsOptional() @MaxLength(500) description?: string;
  @IsArray() @IsOptional() @IsString({ each: true }) permissionKeys?: string[];
  @IsArray() @IsOptional() @IsString({ each: true }) capabilityPackKeys?: string[];
  @IsString() @IsOptional() @MaxLength(120) roleTemplateKey?: string;
}

export class UpdateRoleDto implements UpdateRoleInput {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsString() @IsOptional() @MaxLength(500) description?: string;
  @IsArray() @IsOptional() @IsString({ each: true }) permissionKeys?: string[];
  @IsArray() @IsOptional() @IsString({ each: true }) capabilityPackKeys?: string[];
}

export class RolePreviewDto implements RolePreviewInput {
  @IsArray() @IsOptional() @IsString({ each: true }) capabilityPackKeys?: string[];
  @IsArray() @IsOptional() @IsString({ each: true }) permissionKeys?: string[];
  @IsString() @IsOptional() @MaxLength(120) roleTemplateKey?: string;
  @IsString() @IsOptional() @MaxLength(64) roleId?: string;
}
