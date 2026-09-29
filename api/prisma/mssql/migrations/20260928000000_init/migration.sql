BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[customer_assignment] (
    [id] INT NOT NULL IDENTITY(1,1),
    [customer_name] NVARCHAR(200) NOT NULL,
    [store_number] NVARCHAR(20) NOT NULL,
    [phone_number] NVARCHAR(30),
    [contacted_to_store] CHAR(1) NOT NULL CONSTRAINT [customer_assignment_contacted_to_store_df] DEFAULT 'N',
    [attempted_to_store] CHAR(1) NOT NULL CONSTRAINT [customer_assignment_attempted_to_store_df] DEFAULT 'N',
    [do_not_attempt] CHAR(1) CONSTRAINT [customer_assignment_do_not_attempt_df] DEFAULT 'N',
    [notes] NVARCHAR(max),
    [updated_timestamp] DATETIME2 NOT NULL CONSTRAINT [customer_assignment_updated_timestamp_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [customer_assignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[store_assignment] (
    [open_store] NVARCHAR(50) NOT NULL,
    [closed_store] NVARCHAR(50) NOT NULL,
    [updated_timestamp] DATETIME2 NOT NULL CONSTRAINT [store_assignment_updated_timestamp_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [uq_store_assignment_pair] UNIQUE NONCLUSTERED ([open_store],[closed_store])
);

-- CreateTable
CREATE TABLE [dbo].[employees] (
    [employee_id] NVARCHAR(50) NOT NULL,
    [store_number] NVARCHAR(20) NOT NULL,
    [employee_name] NVARCHAR(200),
    [role] NVARCHAR(20) NOT NULL CONSTRAINT [employees_role_df] DEFAULT 'Employee',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [employees_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [employees_pkey] PRIMARY KEY CLUSTERED ([employee_id])
);

-- CreateTable
CREATE TABLE [dbo].[employee_daily_assignments] (
    [id] INT NOT NULL IDENTITY(1,1),
    [employee_id] NVARCHAR(50) NOT NULL,
    [customer_name] NVARCHAR(200) NOT NULL,
    [store_number] NVARCHAR(20) NOT NULL,
    [assigned_date] DATE NOT NULL CONSTRAINT [employee_daily_assignments_assigned_date_df] DEFAULT CAST(SYSUTCDATETIME() AS date),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [employee_daily_assignments_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [employee_daily_assignments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [uq_customer_per_day] UNIQUE NONCLUSTERED ([customer_name],[store_number],[assigned_date])
);

-- CreateTable
CREATE TABLE [dbo].[store_details] (
    [rtl_loc_id] NVARCHAR(50) NOT NULL,
    [store_nbr] NVARCHAR(50) NOT NULL,
    [store_name] NVARCHAR(100),
    [address1] NVARCHAR(150),
    [address2] NVARCHAR(150),
    [address3] NVARCHAR(150),
    [address4] NVARCHAR(150),
    [city] NVARCHAR(100),
    [state] NVARCHAR(50),
    [postal_code] NVARCHAR(20),
    [country] NVARCHAR(50),
    [neighborhood] NVARCHAR(100),
    [county] NVARCHAR(100),
    [telephone1] NVARCHAR(20),
    [store_manager] NVARCHAR(100),
    [email_addr] NVARCHAR(100),
    [record_state] NVARCHAR(20) CONSTRAINT [store_details_record_state_df] DEFAULT 'ACTIVE',
    [create_date] DATETIME2 CONSTRAINT [store_details_create_date_df] DEFAULT CURRENT_TIMESTAMP,
    [update_date] DATETIME2 CONSTRAINT [store_details_update_date_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [store_details_pkey] PRIMARY KEY CLUSTERED ([rtl_loc_id]),
    CONSTRAINT [store_details_store_nbr_key] UNIQUE NONCLUSTERED ([store_nbr])
);

-- Hand-written: Y/N flag checks, mirroring the Postgres baseline (Prisma can't express CHECK).
ALTER TABLE [dbo].[customer_assignment] ADD CONSTRAINT [customer_assignment_contacted_to_store_check] CHECK ([contacted_to_store] IN ('Y', 'N'));
ALTER TABLE [dbo].[customer_assignment] ADD CONSTRAINT [customer_assignment_attempted_to_store_check] CHECK ([attempted_to_store] IN ('Y', 'N'));

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_eda_employee_date] ON [dbo].[employee_daily_assignments]([employee_id], [assigned_date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [idx_eda_assigned_date] ON [dbo].[employee_daily_assignments]([assigned_date], [store_number], [customer_name]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

