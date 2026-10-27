[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080'
)

$ErrorActionPreference = 'Stop'
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:FailureCount = 0
$script:CleanupItems = [System.Collections.Generic.List[object]]::new()
$script:Config = @{}
$script:Tokens = @{}
$script:RecordIds = @{
    Students      = [System.Collections.Generic.List[string]]::new()
    Employees     = [System.Collections.Generic.List[string]]::new()
    Classes       = [System.Collections.Generic.List[string]]::new()
    Subjects      = [System.Collections.Generic.List[string]]::new()
    Allocations   = [System.Collections.Generic.List[string]]::new()
    Enrollments   = [System.Collections.Generic.List[string]]::new()
    Grades        = [System.Collections.Generic.List[string]]::new()
    Attendance    = [System.Collections.Generic.List[string]]::new()
    EventIds      = [System.Collections.Generic.List[string]]::new()
    UserIds       = [System.Collections.Generic.List[string]]::new()
}
$script:TestUserEmails = [System.Collections.Generic.List[string]]::new()
$script:StudentSearchNames = [System.Collections.Generic.List[string]]::new()
$script:StudentRegistrations = [System.Collections.Generic.List[string]]::new()
$script:EmployeeEmails = [System.Collections.Generic.List[string]]::new()
$script:ClassNames = [System.Collections.Generic.List[string]]::new()
$script:SubjectNames = [System.Collections.Generic.List[string]]::new()
$script:GradeSubject = $null
$script:RunId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$script:StartedAt = [DateTime]::UtcNow
$script:StudentId = $null
$script:SecondStudentId = $null
$script:TeacherOneId = $null
$script:TeacherTwoId = $null
$script:ClassOneId = $null
$script:ClassTwoId = $null
$script:SubjectOneId = $null
$script:SubjectTwoId = $null
$script:EnrollmentId = $null
$script:RabbitWasRunning = $false
$script:RabbitStopped = $false
$script:NotificationBaseline = @{}
$script:CleanupDone = $false
$script:AdminUserId = $null
$script:BaseUrl = $BaseUrl.TrimEnd('/')

function Write-Result {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][bool]$Passed,
        [Parameter(Mandatory)][string]$Status
    )
    if ($Passed) {
        Write-Host "PASS $Name (HTTP $Status)"
    }
    else {
        $script:FailureCount++
        Write-Host "FAIL $Name (HTTP $Status)"
    }
}

function Read-LocalConfig {
    $envPath = Join-Path $script:ProjectRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw 'Arquivo .env não encontrado na raiz do projeto.'
    }
    foreach ($line in [IO.File]::ReadLines($envPath)) {
        if ($line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
            $value = $matches[2].Trim()
            if ($value.Length -ge 2 -and (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $script:Config[$matches[1]] = $value
        }
    }
    foreach ($key in @('ADMIN_EMAIL', 'ADMIN_PASSWORD', 'JWT_SECRET', 'RABBITMQ_USER', 'RABBITMQ_PASSWORD', 'POSTGRES_USER')) {
        if ([string]::IsNullOrWhiteSpace($script:Config[$key])) {
            throw "A variável $key está ausente ou vazia no .env."
        }
    }
    $limit = 20
    if (-not [int]::TryParse([string]$script:Config['LOGIN_RATE_LIMIT'], [ref]$limit) -or $limit -lt 1) {
        $limit = 20
    }
    $script:Config['LOGIN_RATE_LIMIT'] = [string]$limit
}

function Invoke-Http {
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST', 'PUT', 'PATCH', 'DELETE')][string]$Method,
        [Parameter(Mandatory)][string]$Uri,
        [hashtable]$Headers = @{},
        [object]$Body,
        [string]$ContentType = 'application/json',
        [int]$TimeoutSec = 15
    )
    $request = @{
        Method          = $Method
        Uri             = $Uri
        Headers         = $Headers
        UseBasicParsing = $true
        ErrorAction     = 'Stop'
        TimeoutSec      = $TimeoutSec
    }
    if ($PSBoundParameters.ContainsKey('Body')) {
        $request.Body = if ($ContentType -eq 'application/json') {
            ConvertTo-Json -InputObject $Body -Depth 15 -Compress
        }
        else {
            $Body
        }
        $request.ContentType = $ContentType
    }
    try {
        $response = Invoke-WebRequest @request
        $content = $response.Content
        $status = [int]$response.StatusCode
    }
    catch {
        $response = $_.Exception.Response
        if ($null -eq $response) {
            return [pscustomobject]@{ Status = 0; Data = $null }
        }
        $status = [int]$response.StatusCode
        $content = $null
        try {
            $stream = $response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = [IO.StreamReader]::new($stream)
                $content = $reader.ReadToEnd()
                $reader.Dispose()
            }
        }
        catch {
            $content = $null
        }
    }
    $data = $null
    if (-not [string]::IsNullOrWhiteSpace([string]$content)) {
        try {
            $data = ConvertFrom-Json -InputObject $content -ErrorAction Stop
        }
        catch {
            $data = $content
        }
    }
    return [pscustomobject]@{ Status = $status; Data = $data }
}

function Assert-Status {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)]$Response,
        [Parameter(Mandatory)][int[]]$Expected
    )
    $passed = $Expected -contains [int]$Response.Status
    Write-Result -Name $Name -Passed $passed -Status ([string]$Response.Status)
    return $passed
}

function Get-Value {
    param([object]$Object, [Parameter(Mandatory)][string[]]$Names)
    foreach ($name in $Names) {
        if ($null -ne $Object -and $Object -is [System.Collections.IDictionary] -and $Object.Contains($name)) {
            return $Object[$name]
        }
        if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$name]) {
            return $Object.$name
        }
    }
    return $null
}

function Get-RecordId {
    param([object]$Data)
    $record = $Data
    for ($depth = 0; $depth -lt 5 -and $null -ne $record; $depth++) {
        $id = Get-Value -Object $record -Names @(
            'id', 'student_id', 'studentId', 'employee_id', 'employeeId', 'teacher_id', 'teacherId',
            'class_id', 'classId', 'subject_id', 'subjectId', 'allocation_id', 'allocationId',
            'enrollment_id', 'enrollmentId', 'grade_id', 'gradeId', 'attendance_id', 'attendanceId'
        )
        if ($null -ne $id) {
            return [string]$id
        }
        $record = Get-Value -Object $record -Names @(
            'data', 'student', 'employee', 'class', 'subject', 'allocation', 'enrollment', 'grade', 'attendance'
        )
        if ($record -is [array]) {
            if ($record.Count -eq 0) { return $null }
            $record = $record[0]
        }
    }
    return $null
}

function Get-Collection {
    param([object]$Data)
    $current = $Data
    for ($depth = 0; $depth -lt 5 -and $null -ne $current; $depth++) {
        if ($current -is [array]) { return ,$current }
        $next = $null
        foreach ($name in @('data', 'records', 'items', 'notifications', 'results')) {
            $next = Get-Value -Object $current -Names @($name)
            if ($null -ne $next) { break }
        }
        if ($null -eq $next) { break }
        $current = $next
    }
    return ,@()
}

function Add-Id {
    param(
        [Parameter(Mandatory)][string]$Category,
        [AllowNull()][string]$Id
    )
    $valid = if ($Category -eq 'EventIds') {
        $Id -match '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    }
    else {
        $Id -match '^\d+$'
    }
    if (-not [string]::IsNullOrWhiteSpace($Id) -and $valid -and
        -not $script:RecordIds[$Category].Contains($Id)) {
        $script:RecordIds[$Category].Add($Id)
    }
}

function Get-Base64Url {
    param([byte[]]$Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-RoleToken {
    param([Parameter(Mandatory)][string]$Role, [string]$Subject = 'smoke-test')
    $header = Get-Base64Url -Bytes ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $claims = @{ sub = $Subject; role = $Role; iat = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); exp = [DateTimeOffset]::UtcNow.AddHours(1).ToUnixTimeSeconds() }
    $payload = Get-Base64Url -Bytes ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $claims -Compress)))
    $unsigned = "$header.$payload"
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($script:Config['JWT_SECRET']))
    try {
        $signature = Get-Base64Url -Bytes ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($unsigned)))
    }
    finally {
        $hmac.Dispose()
    }
    return "$unsigned.$signature"
}

function Get-AuthHeaders {
    param([Parameter(Mandatory)][string]$Role)
    return @{ Authorization = "Bearer $($script:Tokens[$Role])" }
}

function Add-ResponseId {
    param(
        [Parameter(Mandatory)]$Response,
        [Parameter(Mandatory)][string]$Category
    )
    Add-Id -Category $Category -Id (Get-RecordId -Data $Response.Data)
}

function Get-ManagementUri {
    param([Parameter(Mandatory)][string]$Path)
    $uriBuilder = [UriBuilder]::new('http', ([uri]$script:BaseUrl).Host, 15672, $Path)
    return $uriBuilder.Uri.AbsoluteUri
}

function Invoke-RabbitManagement {
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [object]$Body
    )
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($script:Config['RABBITMQ_USER']):$($script:Config['RABBITMQ_PASSWORD'])"))
    $request = @{
        Method = $Method
        Uri = (Get-ManagementUri -Path $Path)
        Headers = @{ Authorization = "Basic $basic" }
    }
    if ($PSBoundParameters.ContainsKey('Body')) {
        $request.Body = $Body
    }
    return Invoke-Http @request
}

function Get-QueueInfo {
    param([Parameter(Mandatory)][string]$Queue)
    return Invoke-RabbitManagement -Method GET -Path "/api/queues/%2F/$Queue"
}

function Test-QueueConsumers {
    param([Parameter(Mandatory)][string]$Queue)
    $response = Get-QueueInfo -Queue $Queue
    $consumerCount = Get-Value -Object $response.Data -Names @('consumers')
    $passed = $response.Status -eq 200 -and $null -ne $consumerCount -and [int]$consumerCount -gt 0
    Write-Result -Name "fila $Queue e consumidor ativo" -Passed $passed -Status ([string]$response.Status)
    return $passed
}

function Test-QueueExists {
    param([Parameter(Mandatory)][string]$Queue)
    $response = Get-QueueInfo -Queue $Queue
    $passed = $response.Status -eq 200
    Write-Result -Name "fila $Queue existe" -Passed $passed -Status ([string]$response.Status)
    return $passed
}

function Get-NotificationIds {
    param([string]$Type)
    $uri = "$script:BaseUrl/api/notifications?limit=200"
    if (-not [string]::IsNullOrWhiteSpace($Type)) {
        $uri += "&type=$([uri]::EscapeDataString($Type))"
    }
    $response = Invoke-Http -Method GET -Uri $uri -Headers (Get-AuthHeaders -Role 'admin')
    $ids = @{}
    if ($response.Status -eq 200) {
        foreach ($item in (Get-Collection -Data $response.Data)) {
            $id = [string](Get-Value -Object $item -Names @('event_id', 'eventId', 'id'))
            if (-not [string]::IsNullOrWhiteSpace($id)) { $ids[$id] = $true }
        }
    }
    return ,$ids
}

function Save-NewNotificationIds {
    param([string]$Type)
    $current = Get-NotificationIds -Type $Type
    foreach ($id in $current.Keys) {
        if (-not $script:NotificationBaseline.ContainsKey($id) -and -not $script:RecordIds.EventIds.Contains([string]$id)) {
            Add-Id -Category EventIds -Id ([string]$id)
        }
    }
}

function Invoke-Compose {
    param([Parameter(Mandatory)][string[]]$Arguments)
    Push-Location $script:ProjectRoot
    try {
        $output = & docker compose @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $exitCode; Output = @($output) }
    }
    finally {
        Pop-Location
    }
}

function Get-RabbitRunningState {
    $idResult = Invoke-Compose -Arguments @('ps', '-q', 'rabbitmq')
    if ($idResult.ExitCode -ne 0 -or $idResult.Output.Count -eq 0) { return $false }
    $containerId = [string]$idResult.Output[0]
    if ([string]::IsNullOrWhiteSpace($containerId)) { return $false }
    $state = & docker inspect --format '{{.State.Running}}' $containerId 2>$null
    return ($LASTEXITCODE -eq 0 -and [string]$state -eq 'true')
}

function Wait-ForRabbitConsumers {
    param([int]$TimeoutSeconds = 60)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $queue = Get-QueueInfo -Queue 'notification.events'
        $consumers = Get-Value -Object $queue.Data -Names @('consumers')
        if ($queue.Status -eq 200 -and $null -ne $consumers -and [int]$consumers -gt 0) {
            return $true
        }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Start-RabbitIfNeeded {
    if (-not $script:RabbitStopped) { return $true }
    $result = Invoke-Compose -Arguments @('start', 'rabbitmq')
    if ($result.ExitCode -ne 0) {
        Write-Result -Name 'reprise do RabbitMQ após teste de desconexão' -Passed $false -Status '0'
        return $false
    }
    $script:RabbitStopped = $false
    $ready = Wait-ForRabbitConsumers -TimeoutSeconds 60
    Write-Result -Name 'RabbitMQ e consumidor após reinício' -Passed $ready -Status $(if ($ready) { '200' } else { '0' })
    return $ready
}

function Register-Response {
    param(
        [Parameter(Mandatory)]$Response,
        [Parameter(Mandatory)][string]$Category,
        [Parameter(Mandatory)][string]$Name,
        [int[]]$Expected = @(200, 201)
    )
    $ok = Assert-Status -Name $Name -Response $Response -Expected $Expected
    if ($ok) { Add-ResponseId -Response $Response -Category $Category }
    return $ok
}

function Invoke-RateLimitCase {
    $limit = [int]$script:Config['LOGIN_RATE_LIMIT']
    $invalidLogin = @{
        email = $script:Config['ADMIN_EMAIL']
        password = "smoke-invalid-$script:RunId"
    }
    $response = $null
    for ($attempt = 0; $attempt -lt ($limit + 3); $attempt++) {
        $response = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body $invalidLogin
        if ($response.Status -eq 429) { break }
    }
    $limited = $null -ne $response -and $response.Status -eq 429
    Write-Result -Name 'rate limit de login' -Passed $limited -Status $(if ($null -eq $response) { '0' } else { [string]$response.Status })
    if (-not $limited) { return }

    $deadline = [DateTime]::UtcNow.AddSeconds(80)
    do {
        Start-Sleep -Seconds 2
        $response = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body $invalidLogin
        if ($response.Status -eq 401) {
            Write-Result -Name 'expiração da janela do rate limit' -Passed $true -Status '401'
            return
        }
    } while ([DateTime]::UtcNow -lt $deadline -and $response.Status -eq 429)
    Write-Result -Name 'expiração da janela do rate limit' -Passed $false -Status ([string]$response.Status)
}

function Invoke-Allocation {
    param(
        [hashtable]$Body,
        [string]$Name,
        [int[]]$Expected
    )
    $response = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/allocations" -Headers (Get-AuthHeaders -Role 'admin') -Body $Body
    $ok = Assert-Status -Name $Name -Response $response -Expected $Expected
    if ($response.Status -eq 201) {
        Add-ResponseId -Response $response -Category Allocations
    }
    return $response
}

function Invoke-RabbitDisconnectCase {
    $script:RabbitWasRunning = Get-RabbitRunningState
    if (-not $script:RabbitWasRunning) {
        Write-Result -Name 'RabbitMQ desconectado e restaurado' -Passed $false -Status '0'
        return
    }
    $stop = Invoke-Compose -Arguments @('stop', 'rabbitmq')
    if ($stop.ExitCode -ne 0) {
        Write-Result -Name 'parada controlada do RabbitMQ para teste' -Passed $false -Status '0'
        return
    }
    $script:RabbitStopped = $true
    try {
        Start-Sleep -Seconds 2
        $offlineClassName = "Smoke-Offline-$script:RunId"
        $script:ClassNames.Add($offlineClassName)
        $offlineClassBody = @{
            name = $offlineClassName
            school_year = [DateTime]::UtcNow.Year
            shift = 'morning'
            capacity = 1
            active = $true
        }
        $offlineClass = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/classes" -Headers (Get-AuthHeaders -Role 'admin') -Body $offlineClassBody
        [void](Register-Response -Response $offlineClass -Category Classes -Name 'criação administrativa com RabbitMQ parado' -Expected @(201))
    }
    finally {
        [void](Start-RabbitIfNeeded)
    }

    if ($script:RabbitStopped) { return }
    if ($null -ne $script:TeacherOneId -and $null -ne $script:ClassTwoId -and $null -ne $script:SubjectTwoId) {
        $recoveredAllocation = Invoke-Allocation -Name 'publicação de evento após reconexão do RabbitMQ' -Expected @(201) -Body @{
            class_id = [int]$script:ClassTwoId
            subject_id = [int]$script:SubjectTwoId
            teacher_id = [int]$script:TeacherOneId
            room = "Smoke-Recovered-$script:RunId"
            weekday = 5
            start_time = '14:00'
            end_time = '15:00'
        }
        if ($recoveredAllocation.Status -eq 201) {
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            $found = $false
            do {
                $notifications = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/notifications?type=teacher.assigned&limit=200" -Headers (Get-AuthHeaders -Role 'admin')
                foreach ($item in (Get-Collection -Data $notifications.Data)) {
                    $payload = Get-Value -Object $item -Names @('payload')
                    $classId = [string](Get-Value -Object $payload -Names @('classId', 'class_id'))
                    $teacherId = [string](Get-Value -Object $payload -Names @('teacherId', 'teacher_id'))
                    if ($notifications.Status -eq 200 -and $classId -eq $script:ClassTwoId -and $teacherId -eq $script:TeacherOneId) {
                        $found = $true
                        break
                    }
                }
                if (-not $found) { Start-Sleep -Seconds 2 }
            } while (-not $found -and [DateTime]::UtcNow -lt $deadline)
            Write-Result -Name 'segunda notificação de evento após reinício' -Passed $found -Status ([string]$notifications.Status)
        }
        else {
            Write-Result -Name 'segunda notificação de evento após reinício' -Passed $false -Status ([string]$recoveredAllocation.Status)
        }
    }
    else {
        Write-Result -Name 'segunda notificação de evento após reinício (pré-requisito ausente)' -Passed $false -Status '0'
    }
}

function Invoke-GradePostedEventCase {
    if ([string]::IsNullOrWhiteSpace([string]$script:StudentId) -or
        [string]::IsNullOrWhiteSpace([string]$script:GradeSubject)) {
        Write-Result -Name 'notificação grade.posted' -Passed $false -Status '0'
        return
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $found = $false
    $status = '0'
    do {
        $response = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/notifications?type=grade.posted&limit=200" -Headers (Get-AuthHeaders -Role 'admin')
        $status = [string]$response.Status
        foreach ($notification in (Get-Collection -Data $response.Data)) {
            $id = [string](Get-Value -Object $notification -Names @('event_id', 'eventId', 'id'))
            $payload = Get-Value -Object $notification -Names @('payload')
            $studentId = [string](Get-Value -Object $payload -Names @('studentId', 'student_id'))
            $subject = [string](Get-Value -Object $payload -Names @('subject'))
            if ($id -and -not $script:NotificationBaseline.ContainsKey($id) -and
                $studentId -eq $script:StudentId -and $subject -eq $script:GradeSubject) {
                $script:RecordIds.EventIds.Add($id)
                $found = $true
                break
            }
        }
        if (-not $found) { Start-Sleep -Milliseconds 500 }
    } while (-not $found -and [DateTime]::UtcNow -lt $deadline)
    Write-Result -Name 'notificação grade.posted gerada pelo lançamento de nota' -Passed $found -Status $status
}

function Invoke-SqlCleanup {
    param([Parameter(Mandatory)][string]$Database, [Parameter(Mandatory)][string]$Sql)
    if ([string]::IsNullOrWhiteSpace($Sql)) { return $true }
    $composeArgs = @('exec', '-T', 'postgres', 'psql', '-U', $script:Config['POSTGRES_USER'], '-d', $Database, '-v', 'ON_ERROR_STOP=1', '-c', $Sql)
    $result = Invoke-Compose -Arguments $composeArgs
    Write-Result -Name "cleanup dos registros de teste em $Database" -Passed ($result.ExitCode -eq 0) -Status $(if ($result.ExitCode -eq 0) { '200' } else { '0' })
    return ($result.ExitCode -eq 0)
}

function Read-SqlIds {
    param(
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string]$Sql,
        [Parameter(Mandatory)][string]$Category
    )
    $result = Invoke-Compose -Arguments @(
        'exec', '-T', 'postgres', 'psql', '-U', $script:Config['POSTGRES_USER'],
        '-d', $Database, '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', $Sql
    )
    if ($result.ExitCode -ne 0) { return }
    foreach ($line in $result.Output) {
        Add-Id -Category $Category -Id ([string]$line).Trim()
    }
}

function Join-NumericIds {
    param([System.Collections.Generic.List[string]]$Ids)
    $safe = @($Ids | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique)
    return ($safe -join ',')
}

function Invoke-Cleanup {
    if ($script:CleanupDone) { return }
    $cleanupSucceeded = $true
    $headers = Get-AuthHeaders -Role 'admin'

    foreach ($searchName in $script:StudentSearchNames) {
        $response = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students?q=$([uri]::EscapeDataString($searchName))" -Headers $headers
        foreach ($student in (Get-Collection -Data $response.Data)) {
            $registration = [string](Get-Value -Object $student -Names @('registration'))
            if ($script:StudentRegistrations.Contains($registration)) {
                Add-Id -Category Students -Id ([string](Get-Value -Object $student -Names @('id')))
            }
        }
    }
    foreach ($email in $script:EmployeeEmails) {
        $response = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees?q=$([uri]::EscapeDataString($email))" -Headers $headers
        foreach ($employee in (Get-Collection -Data $response.Data)) {
            if ([string](Get-Value -Object $employee -Names @('email')) -eq $email) {
                Add-Id -Category Employees -Id ([string](Get-Value -Object $employee -Names @('id')))
            }
        }
    }
    $classesResponse = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/classes" -Headers $headers
    foreach ($classRecord in (Get-Collection -Data $classesResponse.Data)) {
        if ($script:ClassNames.Contains([string](Get-Value -Object $classRecord -Names @('name')))) {
            Add-Id -Category Classes -Id ([string](Get-Value -Object $classRecord -Names @('id')))
        }
    }
    $subjectsResponse = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/subjects" -Headers $headers
    foreach ($subjectRecord in (Get-Collection -Data $subjectsResponse.Data)) {
        if ($script:SubjectNames.Contains([string](Get-Value -Object $subjectRecord -Names @('name')))) {
            Add-Id -Category Subjects -Id ([string](Get-Value -Object $subjectRecord -Names @('id')))
        }
    }
    foreach ($classId in $script:RecordIds.Classes) {
        $allocationsResponse = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/allocations?class_id=$classId" -Headers $headers
        foreach ($allocation in (Get-Collection -Data $allocationsResponse.Data)) {
            Add-Id -Category Allocations -Id ([string](Get-Value -Object $allocation -Names @('id')))
        }
    }
    if ($script:GradeSubject) {
        foreach ($studentId in $script:RecordIds.Students) {
            $gradesResponse = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/grades?student_id=$studentId&subject=$([uri]::EscapeDataString($script:GradeSubject))" -Headers $headers
            foreach ($grade in (Get-Collection -Data $gradesResponse.Data)) {
                Add-Id -Category Grades -Id ([string](Get-Value -Object $grade -Names @('id')))
            }
        }

        if ($script:StudentRegistrations.Count -gt 0) {
            $quoted = @($script:StudentRegistrations | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
            Read-SqlIds -Database 'students_db' -Sql "SELECT id FROM students WHERE registration IN ($($quoted -join ','));" -Category Students
        }
        if ($script:EmployeeEmails.Count -gt 0) {
            $quoted = @($script:EmployeeEmails | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
            Read-SqlIds -Database 'staff_db' -Sql "SELECT id FROM employees WHERE email IN ($($quoted -join ','));" -Category Employees
        }
        if ($script:ClassNames.Count -gt 0) {
            $quoted = @($script:ClassNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
            Read-SqlIds -Database 'administrative_db' -Sql "SELECT id FROM classes WHERE name IN ($($quoted -join ','));" -Category Classes
        }
        if ($script:SubjectNames.Count -gt 0) {
            $quoted = @($script:SubjectNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
            Read-SqlIds -Database 'administrative_db' -Sql "SELECT id FROM subjects WHERE name IN ($($quoted -join ','));" -Category Subjects
        }
        $knownClasses = Join-NumericIds -Ids $script:RecordIds.Classes
        $knownSubjects = Join-NumericIds -Ids $script:RecordIds.Subjects
        if ($knownClasses -or $knownSubjects) {
            $allocationPredicate = @()
            if ($knownClasses) { $allocationPredicate += "class_id IN ($knownClasses)" }
            if ($knownSubjects) { $allocationPredicate += "subject_id IN ($knownSubjects)" }
            Read-SqlIds -Database 'administrative_db' -Sql "SELECT id FROM allocations WHERE $($allocationPredicate -join ' OR ');" -Category Allocations
        }
    }

    $students = Join-NumericIds -Ids $script:RecordIds.Students
    $classes = Join-NumericIds -Ids $script:RecordIds.Classes
    $academicStatements = [System.Collections.Generic.List[string]]::new()
    if ($students) {
        $quotedStudentIds = @($students.Split(',') | ForEach-Object { "'$_'" }) -join ','
        Read-SqlIds -Database 'notification_db' -Sql "SELECT event_id FROM event_log WHERE payload->>'studentId' IN ($quotedStudentIds) OR payload->>'student_id' IN ($quotedStudentIds);" -Category EventIds
        $academicStatements.Add("DELETE FROM academic_grades WHERE student_id IN ($students);")
        $academicStatements.Add("DELETE FROM academic_averages WHERE student_id IN ($students);")
        $quotedProcessedEvents = @($script:RecordIds.EventIds | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        if ($quotedProcessedEvents.Count -gt 0) {
            $academicStatements.Add("DELETE FROM academic_processed_events WHERE event_id IN ($($quotedProcessedEvents -join ','));")
        }
        $academicStatements.Add("DELETE FROM academic_enrollments WHERE student_id IN ($students);")
        $academicStatements.Add("DELETE FROM academic_attendance WHERE student_id IN ($students);")
    }
    if ($academicStatements.Count -gt 0) {
        if (-not (Invoke-SqlCleanup -Database 'academic_db' -Sql ($academicStatements -join ' '))) { $cleanupSucceeded = $false }
    }

    foreach ($id in $script:RecordIds.Allocations) {
        $response = Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/administrative/allocations/$id" -Headers $headers
        [void](Assert-Status -Name 'cleanup de alocação' -Response $response -Expected @(200, 204, 404))
    }
    foreach ($id in $script:RecordIds.Classes) {
        $response = Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/administrative/classes/$id" -Headers $headers
        [void](Assert-Status -Name 'cleanup de turma' -Response $response -Expected @(200, 204, 404))
    }
    foreach ($id in $script:RecordIds.Subjects) {
        $response = Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/administrative/subjects/$id" -Headers $headers
        [void](Assert-Status -Name 'cleanup de disciplina' -Response $response -Expected @(200, 204, 404))
    }
    foreach ($id in $script:RecordIds.Employees) {
        $response = Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/employees/$id" -Headers $headers
        [void](Assert-Status -Name 'cleanup de funcionário' -Response $response -Expected @(200, 204, 404))
    }
    foreach ($id in $script:RecordIds.Students) {
        $response = Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/students/$id" -Headers $headers
        [void](Assert-Status -Name 'cleanup de aluno' -Response $response -Expected @(200, 204, 404))
    }

    if ($script:TestUserEmails.Count -gt 0) {
        $quotedEmailsForIds = @($script:TestUserEmails | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        $idQuery = "SELECT id FROM users WHERE email IN ($($quotedEmailsForIds -join ','));"
        $userQuery = Invoke-Compose -Arguments @(
            'exec', '-T', 'postgres', 'psql', '-U', $script:Config['POSTGRES_USER'],
            '-d', 'users_db', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', $idQuery
        )
        foreach ($line in $userQuery.Output) {
            $candidate = ([string]$line).Trim()
            Add-Id -Category UserIds -Id $candidate
        }
    }

    $eventSql = [System.Collections.Generic.List[string]]::new()
    $quotedEvents = @($script:RecordIds.EventIds | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
    if ($quotedEvents.Count -gt 0) {
        $eventSql.Add("DELETE FROM event_log WHERE event_id IN ($($quotedEvents -join ','));")
    }
    if ($students) {
        $quotedStudentIds = @($students.Split(',') | ForEach-Object { "'$_'" }) -join ','
        $eventSql.Add("DELETE FROM event_log WHERE payload->>'studentId' IN ($quotedStudentIds) OR payload->>'student_id' IN ($quotedStudentIds);")
    }
    if ($script:RecordIds.Classes.Count -gt 0) {
        $classIds = Join-NumericIds -Ids $script:RecordIds.Classes
        if ($classIds) {
            $quotedClassIds = @($classIds.Split(',') | ForEach-Object { "'$_'" }) -join ','
            $eventSql.Add("DELETE FROM event_log WHERE payload->>'classId' IN ($quotedClassIds);")
        }
    }
    if ($script:RecordIds.Employees.Count -gt 0) {
        $employeeIds = Join-NumericIds -Ids $script:RecordIds.Employees
        if ($employeeIds) {
            $quotedEmployeeIds = @($employeeIds.Split(',') | ForEach-Object { "'$_'" }) -join ','
            $eventSql.Add("DELETE FROM event_log WHERE payload->>'teacherId' IN ($quotedEmployeeIds) OR payload->>'employeeId' IN ($quotedEmployeeIds);")
        }
        if ($script:RecordIds.Subjects.Count -gt 0) {
            $subjectIds = Join-NumericIds -Ids $script:RecordIds.Subjects
            if ($subjectIds) {
                $quotedSubjectIds = @($subjectIds.Split(',') | ForEach-Object { "'$_'" }) -join ','
                $eventSql.Add("DELETE FROM event_log WHERE payload->>'subjectId' IN ($quotedSubjectIds);")
            }
        }
        if ($script:RecordIds.UserIds.Count -gt 0) {
            $userIds = Join-NumericIds -Ids $script:RecordIds.UserIds
            if ($userIds) {
                $quotedUserIds = @($userIds.Split(',') | ForEach-Object { "'$_'" }) -join ','
                $eventSql.Add("DELETE FROM event_log WHERE payload->>'userId' IN ($quotedUserIds);")
            }
        }
    }
    if ($eventSql.Count -gt 0) {
        if (-not (Invoke-SqlCleanup -Database 'notification_db' -Sql ($eventSql -join ' '))) { $cleanupSucceeded = $false }
    }
    if ($script:ClassNames.Count -gt 0 -or $script:SubjectNames.Count -gt 0) {
        $adminSql = [System.Collections.Generic.List[string]]::new()
        $classNamesSql = @($script:ClassNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        $subjectNamesSql = @($script:SubjectNames | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        if ($classNamesSql.Count -gt 0 -and $subjectNamesSql.Count -gt 0) {
            $adminSql.Add("DELETE FROM allocations WHERE class_id IN (SELECT id FROM classes WHERE name IN ($($classNamesSql -join ','))) OR subject_id IN (SELECT id FROM subjects WHERE name IN ($($subjectNamesSql -join ',')));")
        }
        elseif ($classNamesSql.Count -gt 0) {
            $adminSql.Add("DELETE FROM allocations WHERE class_id IN (SELECT id FROM classes WHERE name IN ($($classNamesSql -join ',')));")
        }
        elseif ($subjectNamesSql.Count -gt 0) {
            $adminSql.Add("DELETE FROM allocations WHERE subject_id IN (SELECT id FROM subjects WHERE name IN ($($subjectNamesSql -join ',')));")
        }
        if ($classNamesSql.Count -gt 0) { $adminSql.Add("DELETE FROM classes WHERE name IN ($($classNamesSql -join ','));") }
        if ($subjectNamesSql.Count -gt 0) { $adminSql.Add("DELETE FROM subjects WHERE name IN ($($subjectNamesSql -join ','));") }
        if (-not (Invoke-SqlCleanup -Database 'administrative_db' -Sql ($adminSql -join ' '))) { $cleanupSucceeded = $false }
    }
    if ($script:EmployeeEmails.Count -gt 0) {
        $quotedEmployeeEmails = @($script:EmployeeEmails | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        if (-not (Invoke-SqlCleanup -Database 'staff_db' -Sql "DELETE FROM employees WHERE email IN ($($quotedEmployeeEmails -join ','));")) { $cleanupSucceeded = $false }
    }
    if ($script:StudentRegistrations.Count -gt 0) {
        $quotedRegistrations = @($script:StudentRegistrations | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        if (-not (Invoke-SqlCleanup -Database 'students_db' -Sql "DELETE FROM students WHERE registration IN ($($quotedRegistrations -join ','));")) { $cleanupSucceeded = $false }
    }
    if ($script:TestUserEmails.Count -gt 0) {
        $quotedEmails = @($script:TestUserEmails | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Select-Object -Unique)
        if (-not (Invoke-SqlCleanup -Database 'users_db' -Sql "DELETE FROM users WHERE email IN ($($quotedEmails -join ','));")) { $cleanupSucceeded = $false }
    }
    $script:CleanupDone = $cleanupSucceeded
}

try {
    Read-LocalConfig
    $baseUri = [uri]$script:BaseUrl
    if ($baseUri.Scheme -notin @('http', 'https')) {
        throw 'BaseUrl deve usar HTTP ou HTTPS.'
    }

    $health = Invoke-Http -Method GET -Uri "$script:BaseUrl/health"
    [void](Assert-Status -Name 'health do gateway' -Response $health -Expected @(200))
    $serviceHealth = Invoke-Http -Method GET -Uri "$script:BaseUrl/health/services"
    $serviceMap = Get-Value -Object $serviceHealth.Data -Names @('services')
    $allServicesHealthy = $serviceHealth.Status -eq 200 -and $null -ne $serviceMap
    if ($allServicesHealthy) {
        foreach ($service in $serviceMap.PSObject.Properties) {
            if ((Get-Value -Object $service.Value -Names @('status')) -ne 'UP') {
                $allServicesHealthy = $false
            }
        }
    }
    Write-Result -Name 'health de todos os serviços pelo gateway' -Passed $allServicesHealthy -Status ([string]$serviceHealth.Status)

    $script:Tokens['admin'] = New-RoleToken -Role 'admin'
    $script:Tokens['teacher'] = New-RoleToken -Role 'teacher'
    $script:Tokens['student'] = New-RoleToken -Role 'student'
    $script:Tokens['staff'] = New-RoleToken -Role 'staff'
    $script:NotificationBaseline = Get-NotificationIds -Type ''

    $noToken = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students"
    [void](Assert-Status -Name 'Delivery 1: rota protegida sem JWT' -Response $noToken -Expected @(401))
    $invalidToken = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students" -Headers @{ Authorization = 'Bearer invalid.jwt.token' }
    [void](Assert-Status -Name 'Delivery 1: JWT inválido' -Response $invalidToken -Expected @(401))

    $login = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body @{
        email = $script:Config['ADMIN_EMAIL']
        password = $script:Config['ADMIN_PASSWORD']
    }
    if (Assert-Status -Name 'Delivery 1: login administrativo' -Response $login -Expected @(200)) {
        $adminToken = Get-Value -Object $login.Data -Names @('token')
        if ($adminToken) { $script:Tokens['admin'] = [string]$adminToken }
        $user = Get-Value -Object $login.Data -Names @('user')
        $script:AdminUserId = [string](Get-Value -Object $user -Names @('id'))
    }
    $wrongPassword = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body @{
        email = $script:Config['ADMIN_EMAIL']
        password = "wrong-$script:RunId"
    }
    [void](Assert-Status -Name 'Delivery 1: senha administrativa incorreta' -Response $wrongPassword -Expected @(401))
    $adminHeaders = Get-AuthHeaders -Role 'admin'
    $me = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/auth/me" -Headers $adminHeaders
    [void](Assert-Status -Name 'Delivery 1: identidade autenticada' -Response $me -Expected @(200))
    $users = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/users" -Headers $adminHeaders
    [void](Assert-Status -Name 'Delivery 1: listagem administrativa de usuários' -Response $users -Expected @(200))

    $studentAccountEmail = "student-$script:RunId@smoke.invalid"
    $studentAccountPassword = "Smoke-$script:RunId"
    $script:TestUserEmails.Add($studentAccountEmail)
    $publicRegistration = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/register" -Body @{
        name = "Smoke Student $script:RunId"
        email = $studentAccountEmail
        password = $studentAccountPassword
        role = 'admin'
    }
    if (Register-Response -Response $publicRegistration -Category UserIds -Name 'Delivery 1: cadastro público de estudante' -Expected @(201)) {
        Add-Id -Category UserIds -Id (Get-RecordId -Data $publicRegistration.Data)
    }
    $publicUser = Get-Value -Object $publicRegistration.Data -Names @('user')
    $publicRole = Get-Value -Object $publicUser -Names @('role')
    if ($null -eq $publicRole) { $publicRole = Get-Value -Object $publicRegistration.Data -Names @('role') }
    Write-Result -Name 'Delivery 1: perfil público forçado para student' -Passed ([string]$publicRole -eq 'student') -Status ([string]$publicRegistration.Status)
    $duplicateRegistration = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/register" -Body @{
        name = "Smoke Student Duplicate $script:RunId"
        email = $studentAccountEmail
        password = $studentAccountPassword
        role = 'student'
    }
    [void](Assert-Status -Name 'Delivery 1: conflito de e-mail duplicado' -Response $duplicateRegistration -Expected @(409))
    $studentLogin = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body @{
        email = $studentAccountEmail
        password = $studentAccountPassword
    }
    if (Assert-Status -Name 'Delivery 1: login de estudante' -Response $studentLogin -Expected @(200)) {
        $studentToken = Get-Value -Object $studentLogin.Data -Names @('token')
        if ($studentToken) { $script:Tokens['student'] = [string]$studentToken }
        Add-Id -Category UserIds -Id (Get-RecordId -Data (Get-Value -Object $studentLogin.Data -Names @('user')))
    }
    $studentUsersRead = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/users" -Headers (Get-AuthHeaders -Role 'student')
    [void](Assert-Status -Name 'Delivery 1: estudante não acessa usuários' -Response $studentUsersRead -Expected @(403))

    $teacherAccountEmail = "teacher-account-$script:RunId@smoke.invalid"
    $teacherAccountPassword = "Smoke-$script:RunId"
    $script:TestUserEmails.Add($teacherAccountEmail)
    $teacherAccount = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/users" -Headers $adminHeaders -Body @{
        name = "Smoke Teacher User $script:RunId"
        email = $teacherAccountEmail
        password = $teacherAccountPassword
        role = 'teacher'
    }
    if (Register-Response -Response $teacherAccount -Category UserIds -Name 'Delivery 1: criação administrativa de professor' -Expected @(201)) {
        Add-Id -Category UserIds -Id (Get-RecordId -Data $teacherAccount.Data)
    }
    $teacherLogin = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body @{
        email = $teacherAccountEmail
        password = $teacherAccountPassword
    }
    if (Assert-Status -Name 'Delivery 1: login de professor' -Response $teacherLogin -Expected @(200)) {
        $teacherToken = Get-Value -Object $teacherLogin.Data -Names @('token')
        if ($teacherToken) { $script:Tokens['teacher'] = [string]$teacherToken }
        Add-Id -Category UserIds -Id (Get-RecordId -Data (Get-Value -Object $teacherLogin.Data -Names @('user')))
    }

    $staffAccountEmail = "staff-account-$script:RunId@smoke.invalid"
    $staffAccountPassword = "Smoke-$script:RunId"
    $script:TestUserEmails.Add($staffAccountEmail)
    $staffAccount = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/users" -Headers $adminHeaders -Body @{
        name = "Smoke Staff User $script:RunId"
        email = $staffAccountEmail
        password = $staffAccountPassword
        role = 'staff'
    }
    if (Register-Response -Response $staffAccount -Category UserIds -Name 'Delivery 1: criação administrativa de funcionário' -Expected @(201)) {
        Add-Id -Category UserIds -Id (Get-RecordId -Data $staffAccount.Data)
    }
    $staffLogin = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/auth/login" -Body @{
        email = $staffAccountEmail
        password = $staffAccountPassword
    }
    if (Assert-Status -Name 'Delivery 1: login de funcionário' -Response $staffLogin -Expected @(200)) {
        $staffToken = Get-Value -Object $staffLogin.Data -Names @('token')
        if ($staffToken) { $script:Tokens['staff'] = [string]$staffToken }
        Add-Id -Category UserIds -Id (Get-RecordId -Data (Get-Value -Object $staffLogin.Data -Names @('user')))
    }

    $studentName = "Smoke $script:RunId"
    $studentRegistration = "SMK$($script:RunId -replace '[^0-9]', '')"
    $script:StudentSearchNames.Add($studentName)
    $script:StudentRegistrations.Add($studentRegistration)
    $studentBody = @{
        registration = $studentRegistration
        name = $studentName
        birth_date = '2012-01-15'
        class_name = "Smoke-$script:RunId"
    }
    $studentResponse = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/students" -Headers $adminHeaders -Body $studentBody
    if (Register-Response -Response $studentResponse -Category Students -Name 'Delivery 1: criação de aluno' -Expected @(201)) {
        $script:StudentId = Get-RecordId -Data $studentResponse.Data
    }
    $duplicateStudent = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/students" -Headers $adminHeaders -Body $studentBody
    [void](Assert-Status -Name 'Delivery 1: conflito de matrícula duplicada' -Response $duplicateStudent -Expected @(409))
    if ($duplicateStudent.Status -eq 201) { Add-ResponseId -Response $duplicateStudent -Category Students }
    $missingStudentNameBody = $studentBody.Clone()
    $missingStudentNameBody.Remove('name')
    [void](Assert-Status -Name 'Delivery 1: rejeita aluno sem nome' -Response (Invoke-Http -Method POST -Uri "$script:BaseUrl/api/students" -Headers $adminHeaders -Body $missingStudentNameBody) -Expected @(400))
    if ($null -ne $script:StudentId) {
        $studentGet = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students/$script:StudentId" -Headers $adminHeaders
        [void](Assert-Status -Name 'Delivery 1: consulta individual de aluno' -Response $studentGet -Expected @(200))
        $studentList = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students?q=$([uri]::EscapeDataString($studentName))" -Headers $adminHeaders
        [void](Assert-Status -Name 'Delivery 1: pesquisa de alunos' -Response $studentList -Expected @(200))
        $studentUpdate = Invoke-Http -Method PUT -Uri "$script:BaseUrl/api/students/$script:StudentId" -Headers $adminHeaders -Body @{ name = "$studentName atualizado" }
        [void](Assert-Status -Name 'Delivery 1: atualização de aluno' -Response $studentUpdate -Expected @(200))
        $missingStudent = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students/2147483647" -Headers $adminHeaders
        [void](Assert-Status -Name 'Delivery 1: aluno inexistente retorna 404' -Response $missingStudent -Expected @(404))
    }

    $employeeBody = @{
        type = 'teacher'
        name = "Smoke Teacher $script:RunId"
        email = "teacher-$script:RunId@smoke.invalid"
        qualification = 'Smoke'
        subjects = 'Smoke'
    }
    $script:EmployeeEmails.Add([string]$employeeBody.email)
    $employeeOne = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/employees" -Headers $adminHeaders -Body $employeeBody
    if (Register-Response -Response $employeeOne -Category Employees -Name 'Delivery 1: criação de funcionário/professor' -Expected @(201)) {
        $script:TeacherOneId = Get-RecordId -Data $employeeOne.Data
    }
    $invalidEmployeeBody = $employeeBody.Clone()
    $invalidEmployeeBody.type = 'invalid'
    [void](Assert-Status -Name 'Delivery 1: rejeita tipo de funcionário inválido' -Response (Invoke-Http -Method POST -Uri "$script:BaseUrl/api/employees" -Headers $adminHeaders -Body $invalidEmployeeBody) -Expected @(400))
    $duplicateEmployee = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/employees" -Headers $adminHeaders -Body $employeeBody
    [void](Assert-Status -Name 'Delivery 1: conflito de e-mail duplicado de funcionário' -Response $duplicateEmployee -Expected @(409))
    if ($duplicateEmployee.Status -eq 201) { Add-ResponseId -Response $duplicateEmployee -Category Employees }
    $employeeTwoBody = $employeeBody.Clone()
    $employeeTwoBody.name = "Smoke Teacher 2 $script:RunId"
    $employeeTwoBody.email = "teacher2-$script:RunId@smoke.invalid"
    $script:EmployeeEmails.Add([string]$employeeTwoBody.email)
    $employeeTwo = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/employees" -Headers $adminHeaders -Body $employeeTwoBody
    if (Register-Response -Response $employeeTwo -Category Employees -Name 'Delivery 1: criação de segundo professor' -Expected @(201)) {
        $script:TeacherTwoId = Get-RecordId -Data $employeeTwo.Data
    }
    if ($null -ne $script:TeacherOneId) {
        $employeeGet = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees/$script:TeacherOneId" -Headers $adminHeaders
        [void](Assert-Status -Name 'Delivery 1: consulta individual de funcionário' -Response $employeeGet -Expected @(200))
        $employeeList = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees?q=$([uri]::EscapeDataString($employeeBody.name))" -Headers $adminHeaders
        [void](Assert-Status -Name 'Delivery 1: pesquisa de funcionários' -Response $employeeList -Expected @(200))
        $employeeUpdate = Invoke-Http -Method PUT -Uri "$script:BaseUrl/api/employees/$script:TeacherOneId" -Headers $adminHeaders -Body @{ qualification = 'Smoke atualizado' }
        [void](Assert-Status -Name 'Delivery 1: atualização de funcionário' -Response $employeeUpdate -Expected @(200))
    }
    $adminStaffBody = @{
        type = 'admin_staff'
        name = "Smoke Administrative Staff $script:RunId"
        email = "staff-$script:RunId@smoke.invalid"
        qualification = 'Smoke'
        subjects = 'Smoke'
    }
    $script:EmployeeEmails.Add([string]$adminStaffBody.email)
    $adminStaff = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/employees" -Headers $adminHeaders -Body $adminStaffBody
    if (Register-Response -Response $adminStaff -Category Employees -Name 'Delivery 1: criação de admin_staff' -Expected @(201)) {
        $adminStaffId = Get-RecordId -Data $adminStaff.Data
        $adminStaffGet = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees/$adminStaffId" -Headers $adminHeaders
        [void](Assert-Status -Name 'Delivery 1: consulta de admin_staff' -Response $adminStaffGet -Expected @(200))
        [void](Assert-Status -Name 'Delivery 1: exclusão de admin_staff' -Response (Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/employees/$adminStaffId" -Headers $adminHeaders) -Expected @(204))
        [void](Assert-Status -Name 'Delivery 1: funcionário excluído retorna 404' -Response (Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees/$adminStaffId" -Headers $adminHeaders) -Expected @(404))
    }
    $teacherFilter = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees?type=teacher" -Headers $adminHeaders
    $teacherFiltered = $teacherFilter.Status -eq 200
    foreach ($filteredEmployee in (Get-Collection -Data $teacherFilter.Data)) {
        if ((Get-Value -Object $filteredEmployee -Names @('type')) -ne 'teacher') { $teacherFiltered = $false }
    }
    Write-Result -Name 'Delivery 1: filtro de funcionários retorna apenas teachers' -Passed $teacherFiltered -Status ([string]$teacherFilter.Status)
    [void](Assert-Status -Name 'Delivery 1: funcionários sem token' -Response (Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees") -Expected @(401))

    if ($null -ne $script:StudentId) {
        $teacherStudentRead = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students" -Headers (Get-AuthHeaders -Role 'teacher')
        [void](Assert-Status -Name 'permissão: professor consulta alunos' -Response $teacherStudentRead -Expected @(200))
        $studentRoleRead = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students" -Headers (Get-AuthHeaders -Role 'student')
        [void](Assert-Status -Name 'permissão: estudante não acessa lista de alunos' -Response $studentRoleRead -Expected @(403))
        $studentEmployeeRead = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/employees" -Headers (Get-AuthHeaders -Role 'student')
        [void](Assert-Status -Name 'permissão: estudante não acessa funcionários' -Response $studentEmployeeRead -Expected @(403))
        $studentRoleAcademic = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/enrollments" -Headers (Get-AuthHeaders -Role 'student')
        [void](Assert-Status -Name 'permissão: estudante não acessa inscrições administrativas' -Response $studentRoleAcademic -Expected @(403))
        $studentRoleNotifications = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/notifications" -Headers (Get-AuthHeaders -Role 'student')
        [void](Assert-Status -Name 'permissão: estudante não acessa notificações administrativas' -Response $studentRoleNotifications -Expected @(403))
    }

    $stamp = $script:RunId -replace '[^0-9]', ''
    $classOneName = "Smoke-$script:RunId"
    $classTwoName = "Smoke2-$script:RunId"
    $script:ClassNames.Add($classOneName)
    $script:ClassNames.Add($classTwoName)
    $classOneBody = @{
        name = $classOneName
        school_year = [DateTime]::UtcNow.Year
        shift = 'morning'
        capacity = 1
        active = $true
    }
    $classOne = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/classes" -Headers $adminHeaders -Body $classOneBody
    if (Register-Response -Response $classOne -Category Classes -Name 'administração: criação de turma com capacidade' -Expected @(201)) {
        $script:ClassOneId = Get-RecordId -Data $classOne.Data
    }
    $classTwoBody = @{
        name = $classTwoName
        school_year = [DateTime]::UtcNow.Year
        shift = 'afternoon'
        capacity = 30
        active = $true
    }
    $classTwo = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/classes" -Headers $adminHeaders -Body $classTwoBody
    if (Register-Response -Response $classTwo -Category Classes -Name 'administração: criação de segunda turma' -Expected @(201)) {
        $script:ClassTwoId = Get-RecordId -Data $classTwo.Data
    }
    if ($null -ne $script:ClassOneId) {
        $classConflict = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/classes" -Headers $adminHeaders -Body $classOneBody
        [void](Assert-Status -Name 'administração: conflito de turma duplicada' -Response $classConflict -Expected @(409))
        if ($classConflict.Status -eq 201) { Add-ResponseId -Response $classConflict -Category Classes }
        $classList = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/classes" -Headers $adminHeaders
        [void](Assert-Status -Name 'administração: listagem de turmas' -Response $classList -Expected @(200))
        $classGet = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/classes/$script:ClassOneId" -Headers $adminHeaders
        [void](Assert-Status -Name 'administração: consulta de turma' -Response $classGet -Expected @(200))
    }

    $subjectOneName = "Smoke $script:RunId"
    $subjectTwoName = "Smoke2 $script:RunId"
    $script:SubjectNames.Add($subjectOneName)
    $script:SubjectNames.Add($subjectTwoName)
    $subjectOneBody = @{ name = $subjectOneName; workload_hours = 40 }
    $subjectOne = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/subjects" -Headers $adminHeaders -Body $subjectOneBody
    if (Register-Response -Response $subjectOne -Category Subjects -Name 'administração: criação de disciplina' -Expected @(201)) {
        $script:SubjectOneId = Get-RecordId -Data $subjectOne.Data
    }
    $subjectTwoBody = @{ name = $subjectTwoName; workload_hours = 60 }
    $subjectTwo = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/subjects" -Headers $adminHeaders -Body $subjectTwoBody
    if (Register-Response -Response $subjectTwo -Category Subjects -Name 'administração: criação de segunda disciplina' -Expected @(201)) {
        $script:SubjectTwoId = Get-RecordId -Data $subjectTwo.Data
    }
    $subjectList = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/subjects" -Headers $adminHeaders
    [void](Assert-Status -Name 'administração: listagem de disciplinas' -Response $subjectList -Expected @(200))

    if ($null -ne $script:ClassOneId -and $null -ne $script:ClassTwoId -and
        $null -ne $script:SubjectOneId -and $null -ne $script:SubjectTwoId -and
        $null -ne $script:TeacherOneId -and $null -ne $script:TeacherTwoId) {
        $baseAllocation = @{
            class_id = [int]$script:ClassOneId
            subject_id = [int]$script:SubjectOneId
            teacher_id = [int]$script:TeacherOneId
            room = "Sala-$stamp"
            weekday = 1
            start_time = '09:00'
            end_time = '10:00'
        }
        $baseAllocationResponse = Invoke-Allocation -Body $baseAllocation -Name 'administração: criação de alocação' -Expected @(201)

        $professorConflict = @{
            class_id = [int]$script:ClassTwoId
            subject_id = [int]$script:SubjectTwoId
            teacher_id = [int]$script:TeacherOneId
            room = "Sala-Professor-$stamp"
            weekday = 1
            start_time = '09:30'
            end_time = '10:30'
        }
        [void](Invoke-Allocation -Body $professorConflict -Name 'administração: conflito de professor' -Expected @(409))

        $classConflictAllocation = @{
            class_id = [int]$script:ClassOneId
            subject_id = [int]$script:SubjectTwoId
            teacher_id = [int]$script:TeacherTwoId
            room = "Sala-Turma-$stamp"
            weekday = 1
            start_time = '09:30'
            end_time = '10:30'
        }
        [void](Invoke-Allocation -Body $classConflictAllocation -Name 'administração: conflito de turma' -Expected @(409))

        $roomConflict = @{
            class_id = [int]$script:ClassTwoId
            subject_id = [int]$script:SubjectOneId
            teacher_id = [int]$script:TeacherTwoId
            room = "Sala-$stamp"
            weekday = 1
            start_time = '09:30'
            end_time = '10:30'
        }
        [void](Invoke-Allocation -Body $roomConflict -Name 'administração: conflito de sala' -Expected @(409))

        $adjacent = @{
            class_id = [int]$script:ClassTwoId
            subject_id = [int]$script:SubjectTwoId
            teacher_id = [int]$script:TeacherOneId
            room = "Sala-$stamp"
            weekday = 1
            start_time = '10:00'
            end_time = '11:00'
        }
        [void](Invoke-Allocation -Body $adjacent -Name 'administração: horários adjacentes não conflitam' -Expected @(201))

        $invalidTime = $adjacent.Clone()
        $invalidTime.start_time = '25:00'
        [void](Invoke-Allocation -Body $invalidTime -Name 'administração: rejeita horário inválido' -Expected @(400))

        $unknownTeacher = $adjacent.Clone()
        $unknownTeacher.teacher_id = 2147483647
        $unknownTeacher.weekday = 3
        [void](Invoke-Allocation -Body $unknownTeacher -Name 'administração: professor inexistente' -Expected @(404))

        $allocationList = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/allocations?class_id=$script:ClassOneId" -Headers $adminHeaders
        [void](Assert-Status -Name 'administração: listagem de alocações' -Response $allocationList -Expected @(200))
        $schedule = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/classes/$script:ClassOneId/schedule" -Headers $adminHeaders
        [void](Assert-Status -Name 'administração: consulta de horário de turma' -Response $schedule -Expected @(200))
        $teacherSchedule = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/teachers/$script:TeacherOneId/schedule" -Headers $adminHeaders
        [void](Assert-Status -Name 'administração: consulta de horário de professor' -Response $teacherSchedule -Expected @(200))
    }
    else {
        foreach ($case in @('conflito de professor', 'conflito de turma', 'conflito de sala', 'horários adjacentes', 'horário inválido', 'professor inexistente')) {
            Write-Result -Name "administração: $case (pré-requisito ausente)" -Passed $false -Status '0'
        }
    }

    $teacherRead = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/administrative/classes" -Headers (Get-AuthHeaders -Role 'teacher')
    [void](Assert-Status -Name 'permissão: professor consulta turmas' -Response $teacherRead -Expected @(200))
    $teacherWrite = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/administrative/classes" -Headers (Get-AuthHeaders -Role 'teacher') -Body $classTwoBody
    [void](Assert-Status -Name 'permissão: professor não cria turma' -Response $teacherWrite -Expected @(403))
    if ($teacherWrite.Status -eq 201) { Add-ResponseId -Response $teacherWrite -Category Classes }

    $enrollmentResponse = $null
    if ($null -ne $script:StudentId -and $null -ne $script:ClassOneId) {
        $enrollmentBody = @{
            student_id = [int]$script:StudentId
            course_id = [int]$script:ClassOneId
            academic_year = [string][DateTime]::UtcNow.Year
            status = 'active'
        }
        $enrollmentResponse = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/enrollments" -Headers $adminHeaders -Body $enrollmentBody
        if (Register-Response -Response $enrollmentResponse -Category Enrollments -Name 'acadêmico: inscrição dentro da capacidade' -Expected @(201)) {
            $script:EnrollmentId = Get-RecordId -Data $enrollmentResponse.Data
        }
        $duplicateEnrollment = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/enrollments" -Headers $adminHeaders -Body $enrollmentBody
        [void](Assert-Status -Name 'acadêmico: conflito de inscrição duplicada' -Response $duplicateEnrollment -Expected @(409))
        if ($duplicateEnrollment.Status -eq 201) { Add-ResponseId -Response $duplicateEnrollment -Category Enrollments }

        $secondStudentRegistration = "SMK2$stamp"
        $secondStudentName = "Smoke Second $script:RunId"
        $script:StudentRegistrations.Add($secondStudentRegistration)
        $script:StudentSearchNames.Add($secondStudentName)
        $secondStudentBody = @{
            registration = $secondStudentRegistration
            name = $secondStudentName
            birth_date = '2012-02-15'
            class_name = "Smoke-$script:RunId"
        }
        $secondStudent = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/students" -Headers $adminHeaders -Body $secondStudentBody
        if (Register-Response -Response $secondStudent -Category Students -Name 'acadêmico: criação de segundo aluno' -Expected @(201)) {
            $script:SecondStudentId = Get-RecordId -Data $secondStudent.Data
        }
        if ($null -ne $script:SecondStudentId) {
            $overCapacity = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/enrollments" -Headers $adminHeaders -Body @{
                student_id = [int]$script:SecondStudentId
                course_id = [int]$script:ClassOneId
                academic_year = [string][DateTime]::UtcNow.Year
                status = 'active'
            }
            if ($overCapacity.Status -eq 201) {
                Add-ResponseId -Response $overCapacity -Category Enrollments
            }
            [void](Assert-Status -Name 'acadêmico: conflito ao exceder capacidade da turma' -Response $overCapacity -Expected @(409))
        }
        else {
            Write-Result -Name 'acadêmico: conflito de capacidade (segundo aluno indisponível)' -Passed $false -Status '0'
        }
        $enrollmentList = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/enrollments?student_id=$script:StudentId" -Headers $adminHeaders
        [void](Assert-Status -Name 'acadêmico: listagem de inscrições' -Response $enrollmentList -Expected @(200))
        $studentEnrollmentPermission = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/enrollments" -Headers (Get-AuthHeaders -Role 'student') -Body $enrollmentBody
        [void](Assert-Status -Name 'permissão: estudante não cria inscrição' -Response $studentEnrollmentPermission -Expected @(403))
        if ($studentEnrollmentPermission.Status -eq 201) { Add-ResponseId -Response $studentEnrollmentPermission -Category Enrollments }
        $teacherEnrollmentPermission = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/enrollments" -Headers (Get-AuthHeaders -Role 'teacher') -Body $enrollmentBody
        [void](Assert-Status -Name 'permissão: professor não cria inscrição' -Response $teacherEnrollmentPermission -Expected @(403))
        if ($teacherEnrollmentPermission.Status -eq 201) { Add-ResponseId -Response $teacherEnrollmentPermission -Category Enrollments }
    }
    else {
        Write-Result -Name 'acadêmico: fluxo de inscrição e capacidade (pré-requisito ausente)' -Passed $false -Status '0'
    }

    if ($null -ne $script:StudentId -and $null -ne $script:EnrollmentId) {
        $subjectName = "Smoke-$script:RunId"
        $script:GradeSubject = $subjectName
        foreach ($score in @(7, 9)) {
            $weight = if ($score -eq 7) { 1 } else { 3 }
            $grade = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/grades" -Headers $adminHeaders -Body @{
                enrollment_id = [int]$script:EnrollmentId
                student_id = [int]$script:StudentId
                course_id = [int]$script:ClassOneId
                subject = $subjectName
                score = $score
                weight = $weight
            }
            [void](Register-Response -Response $grade -Category Grades -Name "acadêmico: lançamento de nota $score/peso $weight" -Expected @(202))
        }
        $invalidGrade = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/grades" -Headers $adminHeaders -Body @{
            enrollment_id = [int]$script:EnrollmentId
            student_id = [int]$script:StudentId
            course_id = [int]$script:ClassOneId
            subject = $subjectName
            score = 11
            weight = 1
        }
        [void](Assert-Status -Name 'acadêmico: rejeita nota 11' -Response $invalidGrade -Expected @(400))
        if ($invalidGrade.Status -eq 202) { Add-ResponseId -Response $invalidGrade -Category Grades }
        $teacherGradePermission = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/grades" -Headers (Get-AuthHeaders -Role 'teacher') -Body @{
            enrollment_id = [int]$script:EnrollmentId
            student_id = [int]$script:StudentId
            course_id = [int]$script:ClassOneId
            subject = $subjectName
            score = 11
            weight = 1
        }
        [void](Assert-Status -Name 'permissão: professor alcança validação de notas' -Response $teacherGradePermission -Expected @(400))
        if ($teacherGradePermission.Status -eq 202) { Add-ResponseId -Response $teacherGradePermission -Category Grades }
        $studentGradePermission = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/grades" -Headers (Get-AuthHeaders -Role 'student') -Body @{
            enrollment_id = [int]$script:EnrollmentId
            student_id = [int]$script:StudentId
            course_id = [int]$script:ClassOneId
            subject = $subjectName
            score = 8
            weight = 1
        }
        [void](Assert-Status -Name 'permissão: estudante não lança notas' -Response $studentGradePermission -Expected @(403))
        if ($studentGradePermission.Status -eq 202) { Add-ResponseId -Response $studentGradePermission -Category Grades }

        $averageUri = "$script:BaseUrl/api/academic/students/$script:StudentId/average?subject=$([uri]::EscapeDataString($subjectName))"
        $average = $null
        $averageTimer = [Diagnostics.Stopwatch]::StartNew()
        do {
            $average = Invoke-Http -Method GET -Uri $averageUri -Headers $adminHeaders -TimeoutSec 1
            $averageValue = Get-Value -Object $average.Data -Names @('average')
            if ($null -ne $averageValue -and [math]::Abs(([double]$averageValue) - 8.5) -le 0.01) { break }
            if ($average.Status -notin @(200, 202)) { break }
            Start-Sleep -Milliseconds 250
        } while ($averageTimer.Elapsed.TotalSeconds -lt 9)
        $averageTimer.Stop()
        $averageValue = Get-Value -Object $average.Data -Names @('average')
        $averageOk = $average.Status -eq 200 -and $null -ne $averageValue -and
            [math]::Abs(([double]$averageValue) - 8.5) -le 0.01 -and $averageTimer.Elapsed.TotalSeconds -le 10
        Write-Result -Name 'acadêmico: média ponderada 8,5 em até 10 s' -Passed $averageOk -Status ([string]$average.Status)
        $teacherGradesRead = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/grades?student_id=$script:StudentId" -Headers (Get-AuthHeaders -Role 'teacher')
        [void](Assert-Status -Name 'permissão: professor consulta notas' -Response $teacherGradesRead -Expected @(200))
        [void](Assert-Status -Name 'permissão: estudante não consulta notas' -Response (Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/grades" -Headers (Get-AuthHeaders -Role 'student')) -Expected @(403))
        $teacherGrade = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/grades" -Headers (Get-AuthHeaders -Role 'teacher') -Body @{
            enrollment_id = [int]$script:EnrollmentId
            student_id = [int]$script:StudentId
            course_id = [int]$script:ClassOneId
            subject = "Teacher-$script:RunId"
            score = 8
            weight = 1
        }
        [void](Register-Response -Response $teacherGrade -Category Grades -Name 'permissão: professor lança nota' -Expected @(202))

        $dates = @(
            [DateTime]::UtcNow.Date.ToString('yyyy-MM-dd'),
            [DateTime]::UtcNow.Date.AddDays(-1).ToString('yyyy-MM-dd'),
            [DateTime]::UtcNow.Date.AddDays(-2).ToString('yyyy-MM-dd')
        )
        $attendance = Invoke-Http -Method POST -Uri "$script:BaseUrl/api/academic/attendance" -Headers $adminHeaders -Body @{
            records = @(
                @{ student_id = [int]$script:StudentId; date = $dates[0]; status = 'present' },
                @{ student_id = [int]$script:StudentId; date = $dates[1]; status = 'absent' },
                @{ student_id = [int]$script:StudentId; date = $dates[2]; status = 'late' }
            )
        }
        if (Assert-Status -Name 'acadêmico: registro em lote de frequência' -Response $attendance -Expected @(201)) {
            foreach ($record in (Get-Collection -Data $attendance.Data)) {
                Add-Id -Category Attendance -Id ([string](Get-Value -Object $record -Names @('id')))
            }
        }
        $summary = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/students/$script:StudentId/attendance" -Headers $adminHeaders
        $percentage = Get-Value -Object $summary.Data -Names @('attendance_percentage')
        $attendanceOk = $summary.Status -eq 200 -and $null -ne $percentage -and [math]::Abs(([double]$percentage) - 66.67) -le 0.01
        Write-Result -Name 'acadêmico: frequência presente/ausente/atrasado = 66,67%' -Passed $attendanceOk -Status ([string]$summary.Status)
        $teacherAttendance = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/students/$script:StudentId/attendance" -Headers (Get-AuthHeaders -Role 'teacher')
        [void](Assert-Status -Name 'permissão: professor consulta frequência' -Response $teacherAttendance -Expected @(200))
        $studentAttendance = Invoke-Http -Method GET -Uri "$script:BaseUrl/api/academic/students/$script:StudentId/attendance" -Headers (Get-AuthHeaders -Role 'student')
        [void](Assert-Status -Name 'permissão: estudante sem acesso ao resumo acadêmico' -Response $studentAttendance -Expected @(403))
    }
    else {
        Write-Result -Name 'acadêmico: rejeita nota 11 (pré-requisito ausente)' -Passed $false -Status '0'
        Write-Result -Name 'acadêmico: média ponderada 8,5 em até 10 s (pré-requisito ausente)' -Passed $false -Status '0'
        Write-Result -Name 'acadêmico: frequência 66,67% (pré-requisito ausente)' -Passed $false -Status '0'
    }

    [void](Test-QueueConsumers -Queue 'notification.events')
    [void](Test-QueueConsumers -Queue 'academic.grade-average')
    [void](Test-QueueExists -Queue 'distrischool.dlq')
    Invoke-GradePostedEventCase
    if ($null -ne $script:StudentId) {
        [void](Assert-Status -Name 'Delivery 1: exclusão de aluno' -Response (Invoke-Http -Method DELETE -Uri "$script:BaseUrl/api/students/$script:StudentId" -Headers $adminHeaders) -Expected @(204))
        [void](Assert-Status -Name 'Delivery 1: aluno excluído retorna 404' -Response (Invoke-Http -Method GET -Uri "$script:BaseUrl/api/students/$script:StudentId" -Headers $adminHeaders) -Expected @(404))
    }
    Invoke-RabbitDisconnectCase

    Save-NewNotificationIds -Type 'user.logged'
    Invoke-Cleanup
    if ($script:CleanupDone) {
        Invoke-RateLimitCase
    }
    else {
        Write-Result -Name 'rate limit não executado: cleanup incompleto' -Passed $false -Status '0'
    }
}
catch {
    $script:FailureCount++
    Write-Host 'FAIL execução do smoke test (HTTP 0)'
}
finally {
    if ($script:RabbitStopped) {
        [void](Start-RabbitIfNeeded)
    }
    if (-not $script:CleanupDone -and $script:Tokens.ContainsKey('admin')) {
        try {
            Invoke-Cleanup
        }
        catch {
            $script:FailureCount++
            Write-Host 'FAIL cleanup final (HTTP 0)'
        }
    }
}

if ($script:FailureCount -gt 0) {
    Write-Host "Resultado: FAIL ($script:FailureCount falha(s))."
    exit 1
}
Write-Host 'Resultado: PASS.'
exit 0
