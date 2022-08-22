import * as core from '@actions/core'
import * as github from '@actions/github'

// TODO: Ensure this (and the Octokit client) works for non-github.com URLs, as well.
// https://github.com/orgs|users/<ownerName>/projects/<projectNumber>
const urlParse =
  /^(?:https:\/\/)?github\.com\/(?<ownerType>orgs|users)\/(?<ownerName>[^/]+)\/projects\/(?<projectNumber>\d+)/

interface ProjectNodeIDResponse {
  organization?: {
    projectV2: {
      id: string
    }
  }

  user?: {
    projectV2: {
      id: string
    }
  }
}

interface ProjectFieldNodes {
  id: string
  name: string
  options: StatusOption[]
}
interface ProjectFieldNodeIDResponse {
  node: {
    fields: {
      nodes: ProjectFieldNodes[]
    }
  }
}

interface ProjectUpdateItemFieldResponse {
  updateProjectNextItemField: {
    projectNextItem: {
      id: string
    }
  }
}
interface StatusOption {
  id: string
  name: string
}

export async function updateProjectItemStatus(): Promise<void> {
  const projectUrl = core.getInput('project-url', {required: true})
  const ghToken = core.getInput('github-token', {required: true})
  const itemId = core.getInput('item-id', {required: true})
  const status = core.getInput('status', {required: true})

  const octokit = github.getOctokit(ghToken)
  const urlMatch = projectUrl.match(urlParse)

  if (!ghToken) {
    throw new Error('Parameter token or opts.auth is required')
  }

  if (!itemId) {
    throw new Error('Item ID is required')
  }

  if (!status) {
    throw new Error('Status is required')
  }

  core.info(`Project URL: ${projectUrl}`)

  if (!urlMatch) {
    throw new Error(
      `Invalid project URL: ${projectUrl}. Project URL should match the format https://github.com/<orgs-or-users>/<ownerName>/projects/<projectNumber>`
    )
  }

  const ownerName = urlMatch.groups?.ownerName
  const projectNumber = parseInt(urlMatch.groups?.projectNumber ?? '', 10)
  const ownerType = urlMatch.groups?.ownerType
  const ownerTypeQuery = mustGetOwnerTypeQuery(ownerType)

  core.info(`Org name: ${ownerName}`)
  core.info(`Project number: ${projectNumber}`)
  core.info(`Owner type: ${ownerType}`)
  core.info(`Item ID: ${itemId}`)
  core.info(`Status: ${status}`)

  const idResp = await octokit.graphql<ProjectNodeIDResponse>(
    `query getProject($ownerName: String!, $projectNumber: Int!) { 
          ${ownerTypeQuery}(login: $ownerName) {
            projectV2(number: $projectNumber) {
              id
            }
          }
        }`,
    {
      ownerName,
      projectNumber
    }
  )

  core.info(`idResp: ${idResp} ${idResp[ownerTypeQuery]?.projectV2}`)

  const projectId = idResp[ownerTypeQuery]?.projectV2.id
  core.info(`Project ID: ${projectId}`)

  const fieldResp = await octokit.graphql<ProjectFieldNodeIDResponse>(
    `query ($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              fields(first: 20) {
                nodes {
                  ... on ProjectV2Field {
                    id
                    name
                  }
                  ... on ProjectV2IterationField {
                    id
                    name
                    configuration {
                      iterations {
                        startDate
                        id
                      }
                    }
                  }
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }`,
    {
      projectId
    }
  )

  const statusField = getStatusFieldData(fieldResp.node.fields.nodes)
  const statusColumnId = getStatusColumnIdFromOptions(
    statusField.options,
    status
  )
  const statusFieldId = statusField.id

  core.info(`Status field ID: ${statusFieldId}`)
  core.info(`Status column ID: ${statusColumnId}`)

  const updateResp = await octokit.graphql<ProjectUpdateItemFieldResponse>(
    `mutation ($projectId: ID!, $itemId: ID!, $statusFieldId: ID!, $statusColumnId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $statusFieldId
            value: {
              singleSelectOptionId: $statusColumnId
            }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }`,
    {
      projectId,
      itemId,
      statusFieldId,
      statusColumnId
    }
  )

  core.info(`Update response: ${JSON.stringify(updateResp)}`)
}

export function mustGetOwnerTypeQuery(
  ownerType?: string
): 'organization' | 'user' {
  const ownerTypeQuery =
    ownerType === 'orgs'
      ? 'organization'
      : ownerType === 'users'
      ? 'user'
      : null

  if (!ownerTypeQuery) {
    throw new Error(
      `Unsupported ownerType: ${ownerType}. Must be one of 'orgs' or 'users'`
    )
  }

  return ownerTypeQuery
}

export function getStatusFieldData(
  fieldNodes: ProjectFieldNodes[]
): ProjectFieldNodes {
  const statusField = fieldNodes.find(field => field.name === 'Status')
  if (!statusField) {
    throw new Error(`Status field not found.`)
  }
  return statusField
}

export function getStatusColumnIdFromOptions(
  options: StatusOption[],
  status: string
): string {
  const statusColumnId = options.find(option => option.name === status)?.id

  if (!statusColumnId) {
    throw new Error(`Status column ID not found in settings: ${options}`)
  }
  return statusColumnId
}
