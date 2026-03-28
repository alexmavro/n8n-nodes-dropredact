import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mimeForFormat(format: string): string {
	switch (format) {
		case 'docx':
			return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		case 'txt':
			return 'text/plain';
		case 'md':
			return 'text/markdown';
		default:
			return 'application/octet-stream';
	}
}

function parseFilename(headers: Record<string, string> | undefined, fallback: string): string {
	const cd = headers?.['content-disposition'] ?? '';
	const m = cd.match(/filename="?([^";\n]+)"?/);
	return m?.[1] ?? fallback;
}

async function buildFileFormData(
	ctx: IExecuteFunctions,
	itemIndex: number,
	binaryField: string,
	extraFields: Record<string, string>,
): Promise<FormData> {
	const bd = ctx.helpers.assertBinaryData(itemIndex, binaryField);
	const buf = await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryField);
	const fd = new FormData();
	fd.append('file', new Blob([buf], { type: bd.mimeType }), bd.fileName ?? 'document');
	for (const [k, v] of Object.entries(extraFields)) {
		if (v !== '') fd.append(k, v);
	}
	return fd;
}

async function appendRegisterCsv(
	ctx: IExecuteFunctions,
	itemIndex: number,
	registerBinaryField: string,
	fd: FormData,
): Promise<void> {
	const bd = ctx.helpers.assertBinaryData(itemIndex, registerBinaryField);
	const buf = await ctx.helpers.getBinaryDataBuffer(itemIndex, registerBinaryField);
	fd.append('register_csv', new Blob([buf], { type: 'text/csv' }), bd.fileName ?? 'register.csv');
}

function getDetectionFields(ctx: IExecuteFunctions, itemIndex: number): Record<string, string> {
	const fields: Record<string, string> = {
		mode: ctx.getNodeParameter('mode', itemIndex) as string,
		language: ctx.getNodeParameter('language', itemIndex) as string,
		confidence: String(ctx.getNodeParameter('confidence', itemIndex)),
	};

	const opts = ctx.getNodeParameter('additionalOptions', itemIndex, {}) as Record<string, unknown>;
	if (opts.extraNames) fields.extra_names = opts.extraNames as string;
	if (opts.nerEngine) fields.ner_engine = opts.nerEngine as string;
	if (opts.ocr) fields.ocr = 'true';
	if (opts.approvedIndices) fields.approved_indices = opts.approvedIndices as string;

	return fields;
}

/* ------------------------------------------------------------------ */
/*  Node                                                               */
/* ------------------------------------------------------------------ */

export class Dropredact implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'dropredact',
		name: 'dropredact',
		icon: 'file:dropredact.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Redact and de-redact PII in documents using dropredact',
		defaults: {
			name: 'dropredact',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'dropredactApi',
				required: true,
			},
		],
		properties: [
			// ------ Resource ------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Document', value: 'document' },
					{ name: 'Register', value: 'register' },
					{ name: 'System', value: 'system' },
				],
				default: 'document',
			},

			// ------ Operations: Document ------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						name: 'Analyze',
						value: 'analyze',
						description: 'Detect PII spans without redacting (review flow step 1)',
						action: 'Analyze a document',
					},
					{
						name: 'Redact',
						value: 'redact',
						description: 'Redact PII from a document',
						action: 'Redact a document',
					},
					{
						name: 'Redact Batch',
						value: 'redactBatch',
						description: 'Redact PII from multiple documents',
						action: 'Redact multiple documents',
					},
					{
						name: 'De-Redact',
						value: 'deredact',
						description: 'Restore original text using a token register',
						action: 'De-redact a document',
					},
					{
						name: 'De-Redact Batch',
						value: 'deredactBatch',
						description: 'Restore original text in multiple documents',
						action: 'De-redact multiple documents',
					},
				],
				default: 'redact',
			},

			// ------ Operations: Register ------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['register'] } },
				options: [
					{
						name: 'List',
						value: 'list',
						description: 'List all named registers',
						action: 'List registers',
					},
				],
				default: 'list',
			},

			// ------ Operations: System ------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['system'] } },
				options: [
					{
						name: 'Health Check',
						value: 'healthCheck',
						description: 'Check if the dropredact server is running',
						action: 'Health check',
					},
					{
						name: 'Get License',
						value: 'getLicense',
						description: 'Get the current license tier (free or pro)',
						action: 'Get license',
					},
				],
				default: 'healthCheck',
			},

			// ====== PARAMETERS ======

			// ------ File input ------
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description:
					'Name of the binary property containing the file(s) to process. For batch operations with multiple files, use data_0, data_1, etc.',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['analyze', 'redact', 'redactBatch', 'deredact', 'deredactBatch'],
					},
				},
			},

			// ------ Detection parameters ------
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{ name: 'Standard', value: 'standard' },
					{ name: 'GDPR', value: 'gdpr' },
					{ name: 'Extended', value: 'extended' },
					{ name: 'Names Only', value: 'names-only' },
				],
				default: 'standard',
				description:
					'Standard and GDPR are equivalent (all personal data). Extended adds ORG/LOCATION. Names Only detects only person names.',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['analyze', 'redact', 'redactBatch'],
					},
				},
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				options: [
					{ name: 'Auto-Detect', value: 'auto' },
					{ name: 'English', value: 'en' },
					{ name: 'German', value: 'de' },
					{ name: 'French', value: 'fr' },
					{ name: 'Spanish', value: 'es' },
					{ name: 'Italian', value: 'it' },
					{ name: 'Dutch', value: 'nl' },
					{ name: 'Polish', value: 'pl' },
					{ name: 'Swedish', value: 'sv' },
					{ name: 'Danish', value: 'da' },
					{ name: 'Finnish', value: 'fi' },
				],
				default: 'auto',
				description: 'Document language for NER model selection',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['analyze', 'redact', 'redactBatch'],
					},
				},
			},
			{
				displayName: 'Confidence',
				name: 'confidence',
				type: 'number',
				typeOptions: {
					minValue: 0.1,
					maxValue: 1.0,
					numberStepSize: 0.05,
				},
				default: 0.5,
				description:
					'Minimum confidence threshold (0.30=aggressive, 0.50=standard, 0.70=conservative, 0.90=strict)',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['analyze', 'redact', 'redactBatch'],
					},
				},
			},

			// ------ Output format ------
			{
				displayName: 'Output Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'md' },
					{ name: 'Plain Text', value: 'txt' },
					{ name: 'DOCX', value: 'docx' },
				],
				default: 'md',
				description: 'Output file format for the redacted document',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['redact', 'redactBatch', 'deredact', 'deredactBatch'],
					},
				},
			},

			// ------ Register parameters ------
			{
				displayName: 'Register Name',
				name: 'registerName',
				type: 'string',
				default: '',
				description:
					'Server-side named register for cross-document token consistency. Tokens are stored under this name so multiple documents share consistent replacements. Use this OR Register CSV, not both.',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['redact', 'redactBatch'],
					},
				},
			},
			{
				displayName: 'Register CSV Binary Field',
				name: 'registerBinaryField',
				type: 'string',
				default: '',
				description:
					'Binary property containing a register CSV from a previous node. Use this OR Register Name, not both. Leave empty to skip.',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['redact', 'redactBatch', 'deredact', 'deredactBatch'],
					},
				},
			},
			{
				displayName: 'Register Passphrase',
				name: 'registerPassphrase',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'Passphrase for encrypted registers (Pro feature)',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['redact', 'redactBatch', 'deredact', 'deredactBatch'],
					},
				},
			},

			// ------ De-redact: original DOCX ------
			{
				displayName: 'Original DOCX Binary Field',
				name: 'originalDocxField',
				type: 'string',
				default: '',
				description:
					'Binary property containing the original DOCX for format-preserving de-redaction. Required when Output Format is DOCX and you want the original formatting preserved.',
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['deredact'],
					},
				},
			},

			// ------ Advanced options ------
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['analyze', 'redact', 'redactBatch'],
					},
				},
				options: [
					{
						displayName: 'Extra Names',
						name: 'extraNames',
						type: 'string',
						default: '',
						description:
							'Comma-separated list of names to always redact (e.g. project names, code names)',
					},
					{
						displayName: 'NER Engine',
						name: 'nerEngine',
						type: 'options',
						options: [
							{ name: 'Stanza (Default)', value: 'stanza' },
							{ name: 'euroPIIan (Experimental)', value: 'europiian' },
						],
						default: 'stanza',
						description: 'NER engine for name detection',
					},
					{
						displayName: 'OCR',
						name: 'ocr',
						type: 'boolean',
						default: false,
						description:
							'Whether to use OCR for scanned PDFs (requires tesseract on the server)',
					},
					{
						displayName: 'Approved Indices',
						name: 'approvedIndices',
						type: 'string',
						default: '',
						description:
							'Comma-separated detection indices to redact (from a prior Analyze step). Leave empty to redact all.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('dropredactApi');
		const rawUrl = credentials.hostUrl;
		if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
			throw new NodeOperationError(
				this.getNode(),
				'The dropredact Host URL is empty. Configure it in credentials (e.g. http://localhost:7700).',
			);
		}
		const baseUrl = rawUrl.replace(/\/+$/, '');

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// ====== SYSTEM ======
		if (resource === 'system') {
			try {
				const endpoint = operation === 'healthCheck' ? '/health' : '/license';
				const response = await this.helpers.httpRequest({
					method: 'GET',
					url: `${baseUrl}${endpoint}`,
					json: true,
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: 0 } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message } as IDataObject,
						pairedItem: { item: 0 },
					});
				} else {
					throw error;
				}
			}
			return [returnData];
		}

		// ====== REGISTER ======
		if (resource === 'register') {
			try {
				const response = await this.helpers.httpRequest({
					method: 'GET',
					url: `${baseUrl}/registers`,
					json: true,
				});
				if (!Array.isArray(response)) {
					throw new NodeOperationError(
						this.getNode(),
						'Unexpected response from /registers: expected an array.',
					);
				}
				for (const entry of response) {
					returnData.push({
						json: entry as IDataObject,
						pairedItem: { item: 0 },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message } as IDataObject,
						pairedItem: { item: 0 },
					});
				} else {
					throw error;
				}
			}
			return [returnData];
		}

		// ====== DOCUMENT ======
		for (let i = 0; i < items.length; i++) {
			try {
				switch (operation) {
					case 'analyze': {
						const binaryField = this.getNodeParameter('binaryPropertyName', i) as string;
						const fields = getDetectionFields(this, i);
						const fd = await buildFileFormData(this, i, binaryField, fields);

						const result = await this.helpers.httpRequest({
							method: 'POST',
							url: `${baseUrl}/analyze`,
							body: fd,
							json: true,
						});
						returnData.push({
							json: result as IDataObject,
							pairedItem: { item: i },
						});
						break;
					}

					case 'redact': {
						const binaryField = this.getNodeParameter('binaryPropertyName', i) as string;
						const format = this.getNodeParameter('format', i) as string;
						const registerName = this.getNodeParameter('registerName', i, '') as string;
						const registerBinaryField = this.getNodeParameter(
							'registerBinaryField',
							i,
							'',
						) as string;
						const registerPassphrase = this.getNodeParameter(
							'registerPassphrase',
							i,
							'',
						) as string;

						const fields = getDetectionFields(this, i);
						fields.format = format;
						if (registerName) fields.register_name = registerName;
						if (registerPassphrase) fields.register_passphrase = registerPassphrase;

						const fd = await buildFileFormData(this, i, binaryField, fields);

						if (registerBinaryField) {
							await appendRegisterCsv(this, i, registerBinaryField, fd);
						}

						const hasRegister = !!(registerName || registerBinaryField);

						if (hasRegister) {
							const resp = (await this.helpers.httpRequest({
								method: 'POST',
								url: `${baseUrl}/redact`,
								body: fd,
								json: true,
							})) as Record<string, unknown>;

							if (resp.error) {
								throw new NodeOperationError(
									this.getNode(),
									resp.error as string,
								);
							}

							const entry: INodeExecutionData = {
								json: {
									filename: resp.filename,
									register_encrypted: resp.register_encrypted,
									register_name: resp.register_name,
								} as IDataObject,
								binary: {},
								pairedItem: { item: i },
							};

							if (typeof resp.redacted_file !== 'string') {
								throw new NodeOperationError(
									this.getNode(),
									'API did not return a redacted file. Check that your dropredact instance has a Pro license.',
									{ itemIndex: i },
								);
							}
							const redBuf = Buffer.from(resp.redacted_file, 'base64');
							entry.binary!.data = await this.helpers.prepareBinaryData(
								redBuf,
								(resp.filename as string) || `redacted.${format}`,
								mimeForFormat(format),
							);

							if (resp.register_csv) {
								const csv = resp.register_csv as string;
								const regBuf = resp.register_encrypted
									? Buffer.from(csv, 'base64')
									: Buffer.from(csv, 'utf-8');
								entry.binary!.register = await this.helpers.prepareBinaryData(
									regBuf,
									'register.csv',
									'text/csv',
								);
							}

							returnData.push(entry);
						} else {
							const resp = (await this.helpers.httpRequest({
								method: 'POST',
								url: `${baseUrl}/redact`,
								body: fd,
								encoding: 'arraybuffer',
								returnFullResponse: true,
							})) as { body: Buffer; headers: Record<string, string> };

							// Guard against error responses masquerading as files
							const ct = resp.headers?.['content-type'] ?? '';
							if (resp.body?.length > 0 && (ct.includes('application/json') || ct.includes('text/plain'))) {
								const bodyText = Buffer.from(resp.body).toString('utf-8');
								if (ct.includes('application/json')) {
									try {
										const errBody = JSON.parse(bodyText);
										if (errBody.error || errBody.detail) {
											throw new NodeOperationError(
												this.getNode(),
												`dropredact API error: ${errBody.error ?? errBody.detail}`,
												{ itemIndex: i },
											);
										}
									} catch (e) {
										if (e instanceof NodeOperationError) throw e;
									}
								} else if (bodyText.length < 500) {
									throw new NodeOperationError(
										this.getNode(),
										`dropredact API error: ${bodyText}`,
										{ itemIndex: i },
									);
								}
							}

							const filename = parseFilename(resp.headers, `redacted.${format}`);
							const bin = await this.helpers.prepareBinaryData(
								Buffer.from(resp.body),
								filename,
								mimeForFormat(format),
							);
							returnData.push({
								json: { filename },
								binary: { data: bin },
								pairedItem: { item: i },
							});
						}
						break;
					}

					case 'redactBatch': {
						const binaryField = this.getNodeParameter('binaryPropertyName', i) as string;
						const format = this.getNodeParameter('format', i) as string;
						const registerName = this.getNodeParameter('registerName', i, '') as string;
						const registerBinaryField = this.getNodeParameter(
							'registerBinaryField',
							i,
							'',
						) as string;
						const registerPassphrase = this.getNodeParameter(
							'registerPassphrase',
							i,
							'',
						) as string;

						const fields = getDetectionFields(this, i);
						fields.format = format;
						if (registerName) fields.register_name = registerName;
						if (registerPassphrase) fields.register_passphrase = registerPassphrase;

						const fd = new FormData();
						for (const [k, v] of Object.entries(fields)) {
							if (v !== '') fd.append(k, v);
						}

						// Attach all binary files (exclude register CSV)
						const item = this.getInputData()[i];
						const binaryKeys = Object.keys(item?.binary ?? {}).filter(
							(key) =>
								(key === binaryField || key.startsWith(`${binaryField}_`)) &&
								key !== registerBinaryField,
						);
						if (binaryKeys.length === 0) {
							throw new NodeOperationError(
								this.getNode(),
								`No binary data found in field "${binaryField}"`,
								{ itemIndex: i },
							);
						}
						for (const key of binaryKeys) {
							const bd = this.helpers.assertBinaryData(i, key);
							const buf = await this.helpers.getBinaryDataBuffer(i, key);
							fd.append(
								'files',
								new Blob([buf], { type: bd.mimeType }),
								bd.fileName ?? 'document',
							);
						}

						if (registerBinaryField) {
							await appendRegisterCsv(this, i, registerBinaryField, fd);
						}

						const resp = (await this.helpers.httpRequest({
							method: 'POST',
							url: `${baseUrl}/redact/batch`,
							body: fd,
							json: true,
						})) as Record<string, unknown>;

						if (!resp.results || !Array.isArray(resp.results)) {
							throw new NodeOperationError(
								this.getNode(),
								'Batch operation failed: API did not return a results array.',
								{ itemIndex: i },
							);
						}
						const results = resp.results as Array<Record<string, unknown>>;
						for (let ri = 0; ri < results.length; ri++) {
							const r = results[ri];
							if (r.status === 'error') {
								returnData.push({
									json: {
										filename: r.filename,
										error: r.error,
										status: 'error',
									} as IDataObject,
									pairedItem: { item: i },
								});
								continue;
							}
							if (typeof r.redacted_file !== 'string') {
								returnData.push({
									json: {
										filename: r.filename,
										error: 'Missing redacted file in response',
										status: 'error',
									} as IDataObject,
									pairedItem: { item: i },
								});
								continue;
							}
							const buf = Buffer.from(r.redacted_file, 'base64');
							const bin = await this.helpers.prepareBinaryData(
								buf,
								(r.filename as string) || `redacted.${format}`,
								mimeForFormat(format),
							);
							const entry: INodeExecutionData = {
								json: { filename: r.filename as string, status: 'ok' } as IDataObject,
								binary: { data: bin },
								pairedItem: { item: i },
							};
							// Attach batch register to first successful result
							if (ri === 0 && typeof resp.register_csv === 'string') {
								const regBuf = resp.register_encrypted
									? Buffer.from(resp.register_csv as string, 'base64')
									: Buffer.from(resp.register_csv as string, 'utf-8');
								entry.binary!.register = await this.helpers.prepareBinaryData(
									regBuf,
									'register.csv',
									'text/csv',
								);
								(entry.json as Record<string, unknown>).register_encrypted =
									resp.register_encrypted;
							}
							returnData.push(entry);
						}
						break;
					}

					case 'deredact': {
						const binaryField = this.getNodeParameter('binaryPropertyName', i) as string;
						const format = this.getNodeParameter('format', i) as string;
						const registerBinaryField = this.getNodeParameter(
							'registerBinaryField',
							i,
							'',
						) as string;
						const registerPassphrase = this.getNodeParameter(
							'registerPassphrase',
							i,
							'',
						) as string;
						const originalDocxField = this.getNodeParameter(
							'originalDocxField',
							i,
							'',
						) as string;

						if (!registerBinaryField) {
							throw new NodeOperationError(
								this.getNode(),
								'De-redaction requires a register CSV. Set the "Register CSV Binary Field".',
								{ itemIndex: i },
							);
						}

						const fd = await buildFileFormData(this, i, binaryField, { format });
						await appendRegisterCsv(this, i, registerBinaryField, fd);
						if (registerPassphrase) fd.append('register_passphrase', registerPassphrase);

						if (originalDocxField) {
							const docxBd = this.helpers.assertBinaryData(i, originalDocxField);
							const docxBuf = await this.helpers.getBinaryDataBuffer(
								i,
								originalDocxField,
							);
							fd.append(
								'original_docx',
								new Blob([docxBuf], {
									type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
								}),
								docxBd.fileName ?? 'original.docx',
							);
						}

						const resp = (await this.helpers.httpRequest({
							method: 'POST',
							url: `${baseUrl}/deredact`,
							body: fd,
							encoding: 'arraybuffer',
							returnFullResponse: true,
						})) as { body: Buffer; headers: Record<string, string> };

						// Guard against error responses masquerading as files
						const ct = resp.headers?.['content-type'] ?? '';
						if (resp.body?.length > 0 && (ct.includes('application/json') || ct.includes('text/plain'))) {
							const bodyText = Buffer.from(resp.body).toString('utf-8');
							if (ct.includes('application/json')) {
								try {
									const errBody = JSON.parse(bodyText);
									if (errBody.error || errBody.detail) {
										throw new NodeOperationError(
											this.getNode(),
											`dropredact API error: ${errBody.error ?? errBody.detail}`,
											{ itemIndex: i },
										);
									}
								} catch (e) {
									if (e instanceof NodeOperationError) throw e;
								}
							} else if (bodyText.length < 500) {
								throw new NodeOperationError(
									this.getNode(),
									`dropredact API error: ${bodyText}`,
									{ itemIndex: i },
								);
							}
						}

						const filename = parseFilename(resp.headers, `deredacted.${format}`);
						const bin = await this.helpers.prepareBinaryData(
							Buffer.from(resp.body),
							filename,
							mimeForFormat(format),
						);
						returnData.push({
							json: { filename },
							binary: { data: bin },
							pairedItem: { item: i },
						});
						break;
					}

					case 'deredactBatch': {
						const binaryField = this.getNodeParameter('binaryPropertyName', i) as string;
						const format = this.getNodeParameter('format', i) as string;
						const registerBinaryField = this.getNodeParameter(
							'registerBinaryField',
							i,
							'',
						) as string;
						const registerPassphrase = this.getNodeParameter(
							'registerPassphrase',
							i,
							'',
						) as string;

						if (!registerBinaryField) {
							throw new NodeOperationError(
								this.getNode(),
								'Batch de-redaction requires a register CSV. Set the "Register CSV Binary Field".',
								{ itemIndex: i },
							);
						}

						const fd = new FormData();
						fd.append('format', format);
						if (registerPassphrase) fd.append('register_passphrase', registerPassphrase);
						await appendRegisterCsv(this, i, registerBinaryField, fd);

						const item = this.getInputData()[i];
						const binaryKeys = Object.keys(item?.binary ?? {}).filter(
							(key) =>
								(key === binaryField || key.startsWith(`${binaryField}_`)) &&
								key !== registerBinaryField,
						);
						if (binaryKeys.length === 0) {
							throw new NodeOperationError(
								this.getNode(),
								`No binary data found in field "${binaryField}"`,
								{ itemIndex: i },
							);
						}
						for (const key of binaryKeys) {
							const bd = this.helpers.assertBinaryData(i, key);
							const buf = await this.helpers.getBinaryDataBuffer(i, key);
							fd.append(
								'files',
								new Blob([buf], { type: bd.mimeType }),
								bd.fileName ?? 'document',
							);
						}

						const resp = (await this.helpers.httpRequest({
							method: 'POST',
							url: `${baseUrl}/deredact/batch`,
							body: fd,
							json: true,
						})) as Record<string, unknown>;

						if (!resp.results || !Array.isArray(resp.results)) {
							throw new NodeOperationError(
								this.getNode(),
								'Batch operation failed: API did not return a results array.',
								{ itemIndex: i },
							);
						}
						const results = resp.results as Array<Record<string, unknown>>;
						for (const r of results) {
							if (r.status === 'error') {
								returnData.push({
									json: {
										filename: r.filename,
										error: r.error,
										status: 'error',
									} as IDataObject,
									pairedItem: { item: i },
								});
								continue;
							}
							if (typeof r.deredacted_file !== 'string') {
								returnData.push({
									json: {
										filename: r.filename,
										error: 'Missing de-redacted file in response',
										status: 'error',
									} as IDataObject,
									pairedItem: { item: i },
								});
								continue;
							}
							const buf = Buffer.from(r.deredacted_file, 'base64');
							const bin = await this.helpers.prepareBinaryData(
								buf,
								(r.filename as string) || `deredacted.${format}`,
								mimeForFormat(format),
							);
							returnData.push({
								json: { filename: r.filename as string, status: 'ok' } as IDataObject,
								binary: { data: bin },
								pairedItem: { item: i },
							});
						}
						break;
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const err = error as Error & { statusCode?: number; description?: string };
					returnData.push({
						json: {
							error: err.message,
							errorType: err.name,
							statusCode: err.statusCode,
						} as IDataObject,
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
