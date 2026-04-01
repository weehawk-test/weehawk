import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, MinLength, Matches } from "class-validator";
import { composeType } from "../entities/composeType.enum";

export class CreateServiceDto {
    
    @ApiProperty({ example: 'frontend', maxLength: 50 })
    @IsString()
    @MinLength(1)
    @MaxLength(50)
    name!: string;

    @ApiProperty({ 
        example: 'weehawk-app', 
        maxLength: 100,
        description: 'Lowercase, numbers, and single dashes. Must start/end with a letter.'
    })
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    @Matches(/^[a-z](?!.*--)[a-z0-9-]*[a-z]$/, {
        message: 'appName must be lowercase, start and end with a letter, and cannot contain consecutive dashes (--).'
    })
    appName!: string;
    
    @ApiProperty({ example: composeType.COMPOSE, enum: composeType })
    @IsEnum(composeType)
    composeType!: composeType;
    
    @ApiProperty({ example: 'This service handles the web traffic', required: false })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ example: 'version: "3.8"\nservices:\n  web:\n    image: nginx' })
    @IsString()
    @IsNotEmpty()
    dockerConfig!: string;

    @ApiProperty({ example: 'PORT=3000\nNODE_ENV=production', required: false })
    @IsString()
    @IsOptional()
    env?: string;

    @ApiProperty({ example: ['app.example.com'], required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    domains?: string[];

    @ApiProperty({ example: 1, description: 'ID of the parent project' })
    @IsNumber()
    @IsNotEmpty()
    projectId!: number;

    @ApiProperty({ required: false, default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}