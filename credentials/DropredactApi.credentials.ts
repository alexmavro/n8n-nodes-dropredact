import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DropredactApi implements ICredentialType {
	name = 'dropredactApi';
	displayName = 'dropredact API';
	documentationUrl = 'https://dropredact.com';

	properties: INodeProperties[] = [
		{
			displayName: 'Host URL',
			name: 'hostUrl',
			type: 'string',
			default: 'http://localhost:7700',
			placeholder: 'http://dropredact:7700',
			description:
				'Base URL of your dropredact instance. When both run in Docker, use the container name (e.g. http://dropredact:7700), not localhost.',
		},
	];

	test = {
		request: {
			method: 'GET' as const,
			url: '={{$credentials.hostUrl}}/health',
		},
	};
}
