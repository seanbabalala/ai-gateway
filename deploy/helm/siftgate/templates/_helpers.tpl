{{/*
Expand the chart name.
*/}}
{{- define "siftgate.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "siftgate.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart label.
*/}}
{{- define "siftgate.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "siftgate.labels" -}}
helm.sh/chart: {{ include "siftgate.chart" . }}
app.kubernetes.io/name: {{ include "siftgate.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: siftgate
app.kubernetes.io/component: data-plane
{{- end -}}

{{/*
Selector labels.
*/}}
{{- define "siftgate.selectorLabels" -}}
app.kubernetes.io/name: {{ include "siftgate.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Service account name.
*/}}
{{- define "siftgate.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "siftgate.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Secret name for environment variables.
*/}}
{{- define "siftgate.secretName" -}}
{{- coalesce .Values.existingSecret .Values.secrets.existingSecret (printf "%s-env" (include "siftgate.fullname" .)) -}}
{{- end -}}

{{/*
ConfigMap name for gateway.config.yaml.
*/}}
{{- define "siftgate.configMapName" -}}
{{- coalesce .Values.existingConfigMap .Values.config.existingConfigMap (printf "%s-config" (include "siftgate.fullname" .)) -}}
{{- end -}}
